[CmdletBinding()]
param(
  [switch]$OpenBrowser,
  [switch]$ForceBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
$compose = @('compose', '--env-file', $envPath, '-p', 'queueforge', '--profile', 'full')

function Invoke-Docker {
  param([Parameter(Mandatory)][string[]]$Arguments)

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed with exit code $LASTEXITCODE."
  }
}

function Test-Image {
  param([Parameter(Mandatory)][string]$Reference)

  & docker image inspect $Reference *> $null
  return $LASTEXITCODE -eq 0
}

function Remove-LocalBuilder {
  param([Parameter(Mandatory)][string]$Name)

  & docker buildx rm $Name *> $null
  $container = "buildx_buildkit_${Name}0"
  $volume = "${container}_state"
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    & docker container inspect $container *> $null
    $containerExists = $LASTEXITCODE -eq 0
    & docker volume inspect $volume *> $null
    $volumeExists = $LASTEXITCODE -eq 0
    if (-not $containerExists -and -not $volumeExists) { return }
    Start-Sleep -Seconds 1
  }
  throw 'The temporary QueueForge build helper could not be removed cleanly.'
}

Set-Location -LiteralPath $projectRoot

if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is required. Install and start Docker Desktop, then run this file again.'
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is installed but not ready. Open Docker Desktop and wait for it to finish starting.'
}

if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host 'Creating private local settings…' -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot 'generate-env.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'QueueForge could not create its local settings.' }
}
else {
  & (Join-Path $PSScriptRoot 'generate-env.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'QueueForge could not verify its local settings.' }
}

Invoke-Docker -Arguments ($compose + @('config', '--quiet'))
$images = @(& docker @($compose + @('config', '--images')) | Where-Object { $_ } | Sort-Object -Unique)
if ($LASTEXITCODE -ne 0 -or $images.Count -eq 0) {
  throw 'QueueForge could not resolve its local container images.'
}
$missingImages = @($images | Where-Object { -not (Test-Image -Reference $_) })

if ($ForceBuild -or $missingImages.Count -gt 0) {
  Write-Host 'Preparing QueueForge for this laptop. The first run can take several minutes.' -ForegroundColor Cyan
  Write-Host 'Build usage is limited to two CPU cores and 2.5 GB of memory to keep Windows responsive.'
  $builder = 'queueforge-local-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
  $previousParallelLimit = [Environment]::GetEnvironmentVariable('COMPOSE_PARALLEL_LIMIT', 'Process')
  $builderCreated = $false
  try {
    $env:COMPOSE_PARALLEL_LIMIT = '1'
    Invoke-Docker -Arguments @(
      'buildx', 'create',
      '--name', $builder,
      '--driver', 'docker-container',
      '--driver-opt', 'cpuset-cpus=0-1',
      '--driver-opt', 'memory=2560m',
      '--driver-opt', 'memory-swap=2560m'
    )
    $builderCreated = $true
    Invoke-Docker -Arguments @('buildx', 'inspect', $builder, '--bootstrap')
    Invoke-Docker -Arguments ($compose + @('build', '--builder', $builder))
  }
  finally {
    if ([string]::IsNullOrWhiteSpace($previousParallelLimit)) {
      Remove-Item Env:COMPOSE_PARALLEL_LIMIT -ErrorAction SilentlyContinue
    }
    else {
      [Environment]::SetEnvironmentVariable(
        'COMPOSE_PARALLEL_LIMIT',
        $previousParallelLimit,
        'Process'
      )
    }
    if ($builderCreated) { Remove-LocalBuilder -Name $builder }
  }
}
else {
  Write-Host 'QueueForge is already prepared; reusing the local images.' -ForegroundColor DarkGray
}

Write-Host 'Starting the private QueueForge workspace…' -ForegroundColor Cyan
Invoke-Docker -Arguments ($compose + @('up', '-d', '--no-build', '--wait', '--wait-timeout', '300'))

$healthChecks = @(
  'http://127.0.0.1:3001/api/v1/health/ready',
  'http://127.0.0.1:3300/health',
  'http://127.0.0.1:3100/healthz'
)
foreach ($url in $healthChecks) {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 15
  if ($response.StatusCode -ne 200) { throw "QueueForge did not become ready at $url." }
}

$passwordLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -like 'BOOTSTRAP_ADMIN_PASSWORD=*' } | Select-Object -First 1
if ($null -ne $passwordLine) {
  $password = $passwordLine.Substring('BOOTSTRAP_ADMIN_PASSWORD='.Length)
  Set-Clipboard -Value $password
  Write-Host 'The demo password is copied to your clipboard.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'QueueForge is ready.' -ForegroundColor Green
Write-Host 'Email: admin@queueforge.test'
Write-Host 'Password: press Ctrl+V in the password box (it is already copied).'
Write-Host 'Open: http://127.0.0.1:3100'
Write-Host ''
Write-Host 'Your data stays on this laptop. Use STOP-QUEUEFORGE.cmd when you are finished.' -ForegroundColor DarkGray

if ($OpenBrowser) {
  Start-Process 'http://127.0.0.1:3100'
}
