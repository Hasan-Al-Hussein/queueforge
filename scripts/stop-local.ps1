[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'

Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host 'QueueForge has no local settings yet, so there is nothing to stop.'
  exit 0
}

& docker compose --env-file $envPath -p queueforge --profile full down
if ($LASTEXITCODE -ne 0) { throw 'QueueForge could not stop cleanly.' }

Write-Host 'QueueForge is stopped. Its private database was preserved for the next start.' -ForegroundColor Green
