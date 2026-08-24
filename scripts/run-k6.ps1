[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('smoke', 'load')]
    [string] $Scenario = 'smoke'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot '.env'
$k6Path = Join-Path $projectRoot '.tools\k6\2.2.0\k6.exe'
$testScript = Join-Path $projectRoot 'load-tests\queueforge.spec.ts'

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw "Missing $environmentPath. Run 'pnpm env:generate' first."
}

foreach ($line in Get-Content -LiteralPath $environmentPath) {
    if ($line -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') {
        continue
    }
    $pair = $line.Split('=', 2)
    $existing = [Environment]::GetEnvironmentVariable($pair[0], 'Process')
    if ([string]::IsNullOrEmpty($existing)) {
        [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
    }
}

if (-not (Test-Path -LiteralPath $k6Path -PathType Leaf)) {
    throw "Pinned k6 v2.2.0 is not installed. Run 'pnpm k6:install' first."
}
if (-not (Test-Path -LiteralPath $testScript -PathType Leaf)) {
    throw "Missing load test script: $testScript"
}

$apiUrl = if (-not [string]::IsNullOrWhiteSpace($env:K6_API_URL)) {
    $env:K6_API_URL
}
elseif (-not [string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_API_URL)) {
    $env:NEXT_PUBLIC_API_URL
}
else {
    'http://127.0.0.1:3001'
}

try {
    $apiUri = [Uri] $apiUrl
}
catch {
    throw 'K6_API_URL or NEXT_PUBLIC_API_URL must be a valid absolute URL.'
}

$allowedHosts = @('127.0.0.1', 'localhost', '::1', '[::1]')
if (-not $apiUri.IsAbsoluteUri -or $apiUri.Scheme -notin @('http', 'https') -or $apiUri.Host -notin $allowedHosts) {
    throw 'QueueForge load tests are restricted to an explicit loopback API target.'
}

$requiredEnvironment = @(
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'BOOTSTRAP_TENANT_SLUG',
    'SINK_SECRET'
)
foreach ($name in $requiredEnvironment) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $name is not configured."
    }
}

$webOrigin = if (-not [string]::IsNullOrWhiteSpace($env:K6_WEB_ORIGIN)) {
    $env:K6_WEB_ORIGIN
}
elseif (-not [string]::IsNullOrWhiteSpace($env:WEB_ORIGIN)) {
    $env:WEB_ORIGIN
}
else {
    'http://127.0.0.1:3100'
}

$env:K6_API_URL = $apiUri.AbsoluteUri.TrimEnd('/')
$env:K6_WEB_ORIGIN = $webOrigin.TrimEnd('/')
$env:K6_PROFILE = $Scenario
$acmeTenantId = '10000000-0000-4000-8000-000000000001'

$loginBody = @{
    email = $env:BOOTSTRAP_ADMIN_EMAIL
    password = $env:BOOTSTRAP_ADMIN_PASSWORD
    tenantId = $acmeTenantId
} | ConvertTo-Json -Compress
$login = Invoke-RestMethod `
    -Method Post `
    -Uri "$($env:K6_API_URL)/api/v1/auth/login" `
    -ContentType 'application/json' `
    -Headers @{ Origin = $env:K6_WEB_ORIGIN; Accept = 'application/json' } `
    -Body $loginBody
$authorization = @{ Authorization = "Bearer $($login.accessToken)"; Accept = 'application/json' }
$requestsBefore = Invoke-RestMethod `
    -Method Get `
    -Uri "$($env:K6_API_URL)/api/v1/requests?page=1&pageSize=1" `
    -Headers $authorization
$approvalsBefore = Invoke-RestMethod `
    -Method Get `
    -Uri "$($env:K6_API_URL)/api/v1/approvals?page=1&pageSize=1" `
    -Headers $authorization
$workflowsBefore = Invoke-RestMethod `
    -Method Get `
    -Uri "$($env:K6_API_URL)/api/v1/workflows" `
    -Headers $authorization
$datasetBefore = [ordered]@{
    tenantSlug = $login.selectedTenant.tenantSlug
    workflowCount = @($workflowsBefore).Count
    requestCount = [int]$requestsBefore.meta.totalItems
    approvalTaskCount = [int]$approvalsBefore.meta.totalItems
}
$authorization = $null
$login = $null

$summaryDirectory = Join-Path $projectRoot 'test-results\k6'
[System.IO.Directory]::CreateDirectory($summaryDirectory) | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$summaryPath = Join-Path $summaryDirectory "$Scenario-$timestamp-summary.json"
$previousSummaryPath = $env:K6_SUMMARY_PATH
$env:K6_SUMMARY_PATH = $summaryPath

Push-Location -LiteralPath $projectRoot
try {
    & $k6Path run $testScript
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
    $env:K6_SUMMARY_PATH = $previousSummaryPath
}

$contextPath = $summaryPath -replace '-summary\.json$', '-context.json'
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$processors = @(Get-CimInstance Win32_Processor)
$loadVus = if ([string]::IsNullOrWhiteSpace($env:K6_LOAD_VUS)) { 2 } else { [int]$env:K6_LOAD_VUS }
$loadIterations = if ([string]::IsNullOrWhiteSpace($env:K6_LOAD_ITERATIONS)) { 12 } else { [int]$env:K6_LOAD_ITERATIONS }
$effectiveCommand = if ($Scenario -eq 'load') {
    "`$env:K6_LOAD_VUS='$loadVus'; `$env:K6_LOAD_ITERATIONS='$loadIterations'; pwsh scripts/run-k6.ps1 -Scenario load"
}
else {
    'pwsh scripts/run-k6.ps1 -Scenario smoke'
}
$context = [ordered]@{
    recordedAt = [DateTimeOffset]::UtcNow.ToString('o')
    commit = (& git -C $projectRoot rev-parse HEAD).Trim()
    scenario = $Scenario
    command = $effectiveCommand
    apiTarget = $env:K6_API_URL
    webTarget = $env:K6_WEB_ORIGIN
    hardware = [ordered]@{
        operatingSystem = $operatingSystem.Caption
        logicalProcessors = ($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
        memoryBytes = [int64]$operatingSystem.TotalVisibleMemorySize * 1KB
    }
    workload = if ($Scenario -eq 'smoke') {
        [ordered]@{
            scenarios = 5
            vusPerScenario = 1
            iterations = [ordered]@{
                requestSubmission = 1
                idempotencyReplay = 1
                requestListing = 1
                concurrentApprovals = 1
                inboundWebhooks = 1
            }
        }
    }
    else {
        [ordered]@{
            scenarios = 5
            vusPerScenario = $loadVus
            iterations = [ordered]@{
                requestSubmission = $loadIterations
                idempotencyReplay = [int][Math]::Max(2, [Math]::Ceiling($loadIterations / 2))
                requestListing = $loadIterations * 3
                concurrentApprovals = [int][Math]::Max(2, [Math]::Ceiling($loadIterations / 3))
                inboundWebhooks = $loadIterations
            }
        }
    }
    datasetBefore = $datasetBefore
    summary = [System.IO.Path]::GetFileName($summaryPath)
    exitCode = $exitCode
}
[System.IO.File]::WriteAllText(
    $contextPath,
    ($context | ConvertTo-Json -Depth 8),
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "k6 $Scenario summary: $summaryPath"
Write-Host "k6 $Scenario context: $contextPath"
exit $exitCode
