[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $projectRoot 'artifacts\verification'
$artifactPath = Join-Path $artifactDirectory 'environment.json'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null

function Get-CommandVersion {
  param([string]$Command, [string[]]$Arguments)

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue
  if ($null -eq $resolved) {
    return $null
  }
  return (& $Command @Arguments 2>$null | Select-Object -First 1).ToString().Trim()
}

function Test-LocalPortAvailable {
  param([int]$Port)

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
    return $true
  }
  catch {
    return $false
  }
  finally {
    $listener.Stop()
  }
}

$systemDrive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($projectRoot).TrimEnd(':\'))
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$ports = [ordered]@{}
foreach ($candidate in @(3001, 3100, 3300, 5432, 6379)) {
  $ports[$candidate.ToString()] = Test-LocalPortAvailable $candidate
}

$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$dockerHealthy = $false
if ($dockerAvailable) {
  docker info *> $null
  $dockerHealthy = $LASTEXITCODE -eq 0
}

$result = [ordered]@{
  checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
  projectRoot = $projectRoot
  os = $operatingSystem.Caption
  totalMemoryGiB = [Math]::Round($operatingSystem.TotalVisibleMemorySize / 1MB, 2)
  freeMemoryGiB = [Math]::Round($operatingSystem.FreePhysicalMemory / 1MB, 2)
  freeDiskGiB = [Math]::Round($systemDrive.Free / 1GB, 2)
  node = Get-CommandVersion 'node' @('--version')
  pnpm = Get-CommandVersion 'corepack' @('pnpm', '--version')
  git = Get-CommandVersion 'git' @('--version')
  dockerAvailable = $dockerAvailable
  dockerHealthy = $dockerHealthy
  plannedPortsAvailable = $ports
  resourceWarnings = @(
    if (($operatingSystem.FreePhysicalMemory / 1MB) -lt 3) {
      'Less than 3 GiB host RAM is currently free; prefer host-first and sequential verification.'
    }
    if (($systemDrive.Free / 1GB) -lt 10) {
      'Less than 10 GiB disk is free; do not build the full Compose profile.'
    }
  )
}

[System.IO.File]::WriteAllText(
  $artifactPath,
  ($result | ConvertTo-Json -Depth 6),
  [System.Text.UTF8Encoding]::new($false)
)

$result | ConvertTo-Json -Depth 6
