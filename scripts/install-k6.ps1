[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = '2.2.0'
$archiveName = "k6-v$version-windows-amd64.zip"
$downloadUrl = "https://github.com/grafana/k6/releases/download/v$version/$archiveName"
$expectedSha256 = 'ceb2b1e1cf9dbe1303c6c33ec83ffda86dda5c610b4def92064d3c7ebae8d9f4'
$installDirectory = Join-Path $projectRoot ".tools\k6\$version"
$executablePath = Join-Path $installDirectory 'k6.exe'

if (Test-Path -LiteralPath $executablePath) {
  $installedVersion = (& $executablePath version).ToString()
  if ($installedVersion -match [Regex]::Escape("v$version")) {
    Write-Host "k6 v$version is already installed in the project tool cache."
    exit 0
  }
  throw "The existing project k6 executable is not v$version. Remove only '$installDirectory' and retry."
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("queueforge-k6-" + [Guid]::NewGuid())
$archivePath = Join-Path $temporaryRoot $archiveName
$extractPath = Join-Path $temporaryRoot 'extract'
[System.IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($extractPath) | Out-Null

try {
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
  $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "k6 archive checksum mismatch: expected $expectedSha256, received $actualSha256."
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $sourceExecutable = Get-ChildItem -LiteralPath $extractPath -Filter k6.exe -File -Recurse |
    Select-Object -First 1
  if ($null -eq $sourceExecutable) {
    throw 'The verified k6 archive did not contain k6.exe.'
  }

  [System.IO.Directory]::CreateDirectory($installDirectory) | Out-Null
  Copy-Item -LiteralPath $sourceExecutable.FullName -Destination $executablePath
  Write-Host "Installed verified k6 v$version in the ignored project tool cache."
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
