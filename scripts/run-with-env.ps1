[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $Command
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $workspaceRoot '.env'

if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
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
}
else {
    $hasInjectedEnvironment =
        -not [string]::IsNullOrWhiteSpace($env:DATABASE_URL) -or
        -not [string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)
    if (-not $hasInjectedEnvironment) {
        throw "Missing $environmentPath and no database environment was injected. Run 'pnpm env:generate' first."
    }
}

$executable = $Command[0]
$arguments = if ($Command.Count -gt 1) { $Command[1..($Command.Count - 1)] } else { @() }
Push-Location -LiteralPath $workspaceRoot
try {
    & $executable @arguments
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
