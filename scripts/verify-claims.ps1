[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$artifactDirectory = Join-Path $projectRoot 'artifacts\verification'
$artifactPath = Join-Path $artifactDirectory 'claims.json'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null

function Get-RelativePath {
  param([string] $Path)

  return [System.IO.Path]::GetRelativePath($projectRoot, $Path).Replace('\', '/')
}

$evidenceMap = [ordered]@{
  transactionalOutbox = @(
    'packages/persistence/src/stores/outbox.store.ts',
    'tests/integration/database-concurrency.spec.ts'
  )
  tenantIsolation = @(
    'packages/persistence/src/tenant-scope.ts',
    'tests/integration/database-schema.spec.ts'
  )
  refreshRotation = @(
    'packages/persistence/src/stores/identity.store.ts',
    'tests/integration/database-concurrency.spec.ts'
  )
  signedWebhooks = @(
    'packages/application/src/inbound-webhook.service.ts',
    'tests/integration/inbound-webhook-security.spec.ts',
    'tests/integration/webhook-delivery-security.spec.ts'
  )
  workerRecovery = @(
    'apps/worker/src/services/queue-runtime.service.ts',
    'tests/integration/worker-recovery.spec.ts'
  )
  accessibility = @(
    'apps/web/src/test/control-desk.a11y.test.tsx',
    'docs/testing.md'
  )
  threatModel = @('docs/security.md', 'docs/threat-model.md')
}

$missingEvidence = @()
foreach ($claim in $evidenceMap.Keys) {
  foreach ($relativePath in $evidenceMap[$claim]) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
      $missingEvidence += "$claim -> $relativePath"
    }
  }
}

$markdownFiles = @(
  (Join-Path $projectRoot 'README.md')
  (Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs') -Filter '*.md' -File -Recurse |
    ForEach-Object { $_.FullName })
)
$brokenLinks = @()
$linkPattern = [regex]'\[[^\]]+\]\((?<target>[^)]+)\)'
foreach ($markdownPath in $markdownFiles) {
  $content = [System.IO.File]::ReadAllText($markdownPath)
  foreach ($match in $linkPattern.Matches($content)) {
    $target = $match.Groups['target'].Value.Trim('<', '>')
    if ($target -match '^(?:https?://|mailto:|#)') {
      continue
    }
    $pathOnly = [Uri]::UnescapeDataString(($target -split '#', 2)[0])
    if ([string]::IsNullOrWhiteSpace($pathOnly)) {
      continue
    }
    $resolved = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $markdownPath) $pathOnly))
    if (-not (Test-Path -LiteralPath $resolved)) {
      $brokenLinks += "$(Get-RelativePath $markdownPath) -> $target"
    }
  }
}

$publicClaimFiles = @(
  (Join-Path $projectRoot 'README.md'),
  (Join-Path $projectRoot 'docs\career-pack.md')
)
$unsupportedPatterns = @(
  '(?i)\bproduction[- ]ready\b',
  '(?i)\binternet[- ]ready\b',
  '(?i)\bremote CI (?:is |was )?green\b',
  '(?i)\bSOC ?2 certified\b',
  '(?i)\bHIPAA compliant\b'
)
$unsupportedClaims = @()
foreach ($path in $publicClaimFiles) {
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '(?i)\b(?:do not|does not|not|never|cannot|isn''t|is not)\b') {
      continue
    }
    foreach ($pattern in $unsupportedPatterns) {
      if ($line -match $pattern) {
        $unsupportedClaims += "$(Get-RelativePath $path) matches $pattern"
      }
    }
  }
}

$screenshotDirectory = Join-Path $projectRoot 'artifacts\screenshots'
$runtimeAuditPath = Join-Path $screenshotDirectory 'runtime-audit-report.json'
$screenshots = @()
$screenshotEvidenceFailures = @()
if (-not (Test-Path -LiteralPath $runtimeAuditPath -PathType Leaf)) {
  $screenshotEvidenceFailures += 'runtime audit report is missing'
}
else {
  $runtimeAudit = Get-Content -LiteralPath $runtimeAuditPath -Raw | ConvertFrom-Json
  if ($runtimeAudit.status -ne 'passed') {
    $screenshotEvidenceFailures += 'runtime audit report status is not passed'
  }
  foreach ($entry in @($runtimeAudit.screenshots)) {
    $fileName = [string]$entry.file
    if (
      [string]::IsNullOrWhiteSpace($fileName) -or
      [System.IO.Path]::GetFileName($fileName) -ne $fileName -or
      $fileName -notmatch '^[a-z0-9-]+\.png$'
    ) {
      $screenshotEvidenceFailures += "runtime audit contains an unsafe screenshot name: $fileName"
      continue
    }
    $screenshotPath = Join-Path $screenshotDirectory $fileName
    if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
      $screenshotEvidenceFailures += "runtime audit screenshot is missing: $fileName"
      continue
    }
    & git -C $projectRoot ls-files --error-unmatch -- "artifacts/screenshots/$fileName" *> $null
    if ($LASTEXITCODE -ne 0) {
      $screenshotEvidenceFailures += "runtime audit screenshot is not tracked: $fileName"
      continue
    }
    $screenshots += Get-Item -LiteralPath $screenshotPath
  }
}
$e2eResultPath = Join-Path $projectRoot 'tests\e2e\test-results\e2e\.last-run.json'
$e2eStatus = $null
if (Test-Path -LiteralPath $e2eResultPath -PathType Leaf) {
  $e2eStatus = (Get-Content -LiteralPath $e2eResultPath -Raw | ConvertFrom-Json).status
}

$k6Summaries = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'test-results\k6') -Filter '*-summary.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc)
$latestK6 = $k6Summaries | Select-Object -Last 1
$k6ContainsCredential = $false
$k6ThresholdsPassed = $false
$k6Context = $null
if ($null -ne $latestK6) {
  $summaryContent = [System.IO.File]::ReadAllText($latestK6.FullName)
  $k6ContainsCredential = [regex]::IsMatch(
    $summaryContent,
    'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
  )
  $summary = $summaryContent | ConvertFrom-Json
  $requiredMetrics = @('checks', 'http_req_failed', 'queueforge_correctness_errors')
  $thresholdResults = @()
  foreach ($metricName in $requiredMetrics) {
    $metric = $summary.metrics.$metricName
    if ($null -eq $metric -or $null -eq $metric.thresholds) {
      $thresholdResults += $false
      continue
    }
    foreach ($threshold in $metric.thresholds.PSObject.Properties.Value) {
      $thresholdResults += $threshold.ok -eq $true
    }
  }
  foreach ($metric in $summary.metrics.PSObject.Properties.Value) {
    if ($null -ne $metric.thresholds) {
      foreach ($threshold in $metric.thresholds.PSObject.Properties.Value) {
        $thresholdResults += $threshold.ok -eq $true
      }
    }
  }
  $k6ThresholdsPassed = $thresholdResults.Count -gt 0 -and -not ($thresholdResults -contains $false)
  $contextPath = $latestK6.FullName -replace '-summary\.json$', '-context.json'
  if (Test-Path -LiteralPath $contextPath -PathType Leaf) {
    $k6Context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
  }
}

$nextGatePath = Join-Path $projectRoot 'scripts\next-security-gate.json'
$nextGate = Get-Content -LiteralPath $nextGatePath -Raw | ConvertFrom-Json
$gitCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
$dirtyEntries = @(& git -C $projectRoot status --porcelain --untracked-files=all)
$allowedEvidencePatterns = @(
  '^artifacts/verification/(?:claims|clean-start|resources)\.json$',
  '^test-results/k6/[^/]+-(?:summary|context)\.json$'
)
$nonEvidenceChanges = @()
foreach ($entry in $dirtyEntries) {
  $path = $entry.Substring(3).Replace('\', '/')
  if (-not ($allowedEvidencePatterns | Where-Object { $path -match $_ })) {
    $nonEvidenceChanges += $entry
  }
}

function Test-EvidenceRevision {
  param([string] $EvidenceCommit)

  if ([string]::IsNullOrWhiteSpace($EvidenceCommit)) {
    return $false
  }
  & git -C $projectRoot merge-base --is-ancestor $EvidenceCommit $gitCommit
  if ($LASTEXITCODE -ne 0) {
    return $false
  }
  foreach ($path in @(& git -C $projectRoot diff --name-only "$EvidenceCommit..$gitCommit")) {
    $normalized = $path.Replace('\', '/')
    if (-not ($allowedEvidencePatterns | Where-Object { $normalized -match $_ })) {
      return $false
    }
  }
  return $true
}

$resourcePath = Join-Path $projectRoot 'artifacts\verification\resources.json'
$resources = if (Test-Path -LiteralPath $resourcePath -PathType Leaf) {
  Get-Content -LiteralPath $resourcePath -Raw | ConvertFrom-Json
}
else {
  $null
}
$cleanStartPath = Join-Path $projectRoot 'artifacts\verification\clean-start.json'
$cleanStart = if (Test-Path -LiteralPath $cleanStartPath -PathType Leaf) {
  Get-Content -LiteralPath $cleanStartPath -Raw | ConvertFrom-Json
}
else {
  $null
}

$failures = @()
$failures += $missingEvidence | ForEach-Object { "missing evidence: $_" }
$failures += $brokenLinks | ForEach-Object { "broken link: $_" }
$failures += $unsupportedClaims | ForEach-Object { "unsupported public claim: $_" }
$failures += $screenshotEvidenceFailures
if ($screenshots.Count -lt 3) {
  $failures += 'fewer than three real runtime screenshots are present'
}
if ($e2eStatus -ne 'passed') {
  $failures += "latest Playwright status is '$e2eStatus' rather than 'passed'"
}
if ($null -eq $latestK6) {
  $failures += 'no sanitized k6 summary is present'
}
elseif ($k6ContainsCredential) {
  $failures += 'latest k6 summary contains a JWT-shaped credential'
}
elseif (-not $k6ThresholdsPassed) {
  $failures += 'latest k6 summary does not prove every configured threshold passed'
}
if (
  $null -eq $k6Context -or
  -not (Test-EvidenceRevision $k6Context.commit) -or
  $k6Context.exitCode -ne 0 -or
  $null -eq $k6Context.hardware -or
  $null -eq $k6Context.workload -or
  $null -eq $k6Context.datasetBefore -or
  [string]::IsNullOrWhiteSpace($k6Context.command)
) {
  $failures += 'latest k6 evidence lacks matching commit, successful exit, exact command, hardware, dataset, or workload context'
}
if (
  $null -eq $resources -or
  -not (Test-EvidenceRevision $resources.commit) -or
  $resources.withinMemoryBudget -ne $true -or
  $resources.withinDiskBudget -ne $true
) {
  $failures += 'resource evidence is missing, revision-mismatched, or outside the memory/disk budget'
}
if (
  $null -eq $cleanStart -or
  -not (Test-EvidenceRevision $cleanStart.commit) -or
  $cleanStart.frozenInstall -ne 'passed' -or
  $cleanStart.composeConfig -ne 'passed' -or
  $cleanStart.representativeJourney -ne 'passed'
) {
  $failures += 'clean-archive evidence is missing, revision-mismatched, or incomplete'
}
if ($nonEvidenceChanges.Count -gt 0) {
  $failures += "working tree contains $($nonEvidenceChanges.Count) non-evidence change(s) outside the verified commit"
}

$result = [ordered]@{
  checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
  commit = $gitCommit
  workingTreeEntries = $dirtyEntries.Count
  nonEvidenceWorkingTreeEntries = $nonEvidenceChanges.Count
  status = if ($failures.Count -gt 0) {
    'failed'
  }
  elseif ($nextGate.status -eq 'open') {
    'local-evidence-verified-exposure-gate-open'
  }
  else {
    'verified'
  }
  nextSecurityGate = $nextGate.status
  evidenceMap = $evidenceMap
  screenshotCount = $screenshots.Count
  e2eStatus = $e2eStatus
  latestK6Summary = if ($null -eq $latestK6) { $null } else { Get-RelativePath $latestK6.FullName }
  k6ThresholdsPassed = $k6ThresholdsPassed
  cleanStartVerified = $null -ne $cleanStart -and $cleanStart.representativeJourney -eq 'passed'
  resourcesVerified = $null -ne $resources -and $resources.withinMemoryBudget -eq $true -and $resources.withinDiskBudget -eq $true
  failures = $failures
}

[System.IO.File]::WriteAllText(
  $artifactPath,
  ($result | ConvertTo-Json -Depth 8),
  [System.Text.UTF8Encoding]::new($false)
)
$result | ConvertTo-Json -Depth 8

if ($failures.Count -gt 0) {
  exit 1
}
