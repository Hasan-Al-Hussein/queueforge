[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($env:TEST_MIGRATION_DATABASE_URL)) {
    throw 'TEST_MIGRATION_DATABASE_URL is required. Generate .env with pnpm env:generate.'
}
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) {
    throw 'TEST_DATABASE_URL is required. Generate .env with pnpm env:generate.'
}

$env:MIGRATION_DATABASE_URL = $env:TEST_MIGRATION_DATABASE_URL
$env:DATABASE_URL = $env:TEST_DATABASE_URL

Push-Location -LiteralPath $workspaceRoot
try {
    & corepack pnpm --filter '@queueforge/persistence' db:migrate
    if ($LASTEXITCODE -ne 0) {
        throw "Test database migration failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
