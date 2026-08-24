[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$expectedVolume = 'queueforge-test-postgres'

$label = docker volume inspect $expectedVolume --format '{{ index .Labels "com.queueforge.scope" }}' 2>$null
if ($LASTEXITCODE -eq 0 -and $label -ne 'synthetic-test-only') {
  throw "Refusing to remove Docker volume '$expectedVolume': expected synthetic-test-only label was not found."
}

$composeArguments = @(
  'compose',
  '--project-name', 'queueforge-test',
  '--file', (Join-Path $projectRoot 'compose.test.yaml'),
  'down', '--volumes', '--remove-orphans'
)
& docker @composeArguments

if ($LASTEXITCODE -ne 0) {
  throw 'QueueForge test-service reset failed.'
}

Write-Host 'Removed only the labeled QueueForge synthetic test containers and volume.'
