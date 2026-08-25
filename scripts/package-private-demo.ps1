[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

& git diff --quiet
$unstaged = $LASTEXITCODE -ne 0
& git diff --cached --quiet
$staged = $LASTEXITCODE -ne 0
$untracked = @(& git ls-files --others --exclude-standard)
if ($unstaged -or $staged -or $untracked.Count -gt 0) {
  throw 'Commit or remove local changes before packaging. This keeps the ZIP tied to one reviewable revision.'
}

$shortRevision = (& git rev-parse --short=8 HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $shortRevision -notmatch '^[0-9a-f]{8}$') {
  throw 'QueueForge could not identify the current Git revision.'
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $releaseDirectory = Join-Path $projectRoot 'dist'
  $OutputPath = Join-Path $releaseDirectory "QueueForge-private-$shortRevision.zip"
}
else {
  $OutputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
  $releaseDirectory = Split-Path -Parent $OutputPath
}

New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
& git archive --format=zip --output=$OutputPath HEAD
if ($LASTEXITCODE -ne 0) { throw 'Git could not create the private-demo ZIP.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
  $forbidden = @($archive.Entries | Where-Object {
    $_.FullName -match '(^|/)(\.env($|\.)|node_modules|test-results|\.git)(/|$)'
  })
  foreach ($required in @('START-QUEUEFORGE.cmd', 'STOP-QUEUEFORGE.cmd', 'README.md')) {
    if (-not ($archive.Entries | Where-Object { $_.FullName -eq $required })) {
      throw "The package is missing $required."
    }
  }
  if ($forbidden.Count -gt 0) { throw 'The package contains a forbidden local or secret path.' }
}
finally {
  $archive.Dispose()
}

Write-Host "Created $OutputPath" -ForegroundColor Green
Write-Host 'The ZIP contains no .env file or local database. The buyer receives fresh random secrets on first start.'
