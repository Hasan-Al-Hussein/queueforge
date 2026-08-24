[CmdletBinding()]
param(
  [Parameter()]
  [switch] $CaptureBaseline,

  [Parameter()]
  [ValidateRange(1, 120)]
  [int] $Samples = 10,

  [Parameter()]
  [ValidateRange(1, 60)]
  [int] $IntervalSeconds = 2,

  [Parameter()]
  [ValidateLength(3, 120)]
  [string] $WorkloadLabel = 'ready-idle'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$artifactDirectory = Join-Path $projectRoot 'artifacts\verification'
$baselinePath = Join-Path $artifactDirectory 'resource-baseline.json'
$resultPath = Join-Path $artifactDirectory 'resources.json'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null

function ConvertTo-Bytes {
  param([string] $Value)

  $match = [regex]::Match($Value.Trim(), '^(?<number>[0-9]+(?:\.[0-9]+)?)\s*(?<unit>[KMGT]?i?B)$', 'IgnoreCase')
  if (-not $match.Success) {
    throw "Unsupported Docker size value '$Value'."
  }
  $number = [double]$match.Groups['number'].Value
  $factor = switch ($match.Groups['unit'].Value.ToUpperInvariant()) {
    'B' { 1 }
    'KB' { 1000 }
    'KIB' { 1KB }
    'MB' { 1000000 }
    'MIB' { 1MB }
    'GB' { 1000000000 }
    'GIB' { 1GB }
    'TB' { 1000000000000 }
    'TIB' { 1TB }
    default { throw "Unsupported Docker size unit in '$Value'." }
  }
  return [int64]($number * $factor)
}

function Get-DockerDiskSnapshot {
  $snapshot = [ordered]@{}
  foreach ($line in @(& docker system df --format '{{json .}}')) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    $row = $line | ConvertFrom-Json
    $snapshot[$row.Type] = [ordered]@{
      totalCount = [int]$row.TotalCount
      active = [int]$row.Active
      sizeBytes = ConvertTo-Bytes $row.Size
    }
  }
  return $snapshot
}

function Get-SnapshotTotalBytes {
  param($Snapshot)

  $total = [int64]0
  $values = if ($Snapshot -is [System.Collections.IDictionary]) {
    $Snapshot.Values
  }
  else {
    $Snapshot.PSObject.Properties.Value
  }
  foreach ($value in $values) {
    $total += [int64]$value.sizeBytes
  }
  return $total
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is not healthy.'
}

$dockerDisk = Get-DockerDiskSnapshot
if ($CaptureBaseline) {
  $baseline = [ordered]@{
    formatVersion = 2
    dockerSizeUnits = 'si-and-iec'
    capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
    docker = $dockerDisk
  }
  [System.IO.File]::WriteAllText(
    $baselinePath,
    ($baseline | ConvertTo-Json -Depth 8),
    [System.Text.UTF8Encoding]::new($false)
  )
  $baseline | ConvertTo-Json -Depth 8
  exit 0
}

if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) {
  throw "Missing resource baseline. Run 'pwsh scripts/measure-resources.ps1 -CaptureBaseline' before building or starting the full profile."
}

$containerIds = @(& docker compose --profile full ps --all -q)
if ($containerIds.Count -eq 0) {
  throw "No QueueForge full-profile containers are running. Start them before measuring resources."
}

$peakContainerBytes = [int64]0
$peakHostBytes = [int64]0
$sampleRows = @()
for ($sample = 1; $sample -le $Samples; $sample++) {
  $containerBytes = [int64]0
  foreach ($line in @(& docker stats --no-stream --format '{{json .}}' @containerIds)) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    $row = $line | ConvertFrom-Json
    $used = ($row.MemUsage -split '/', 2)[0].Trim()
    $containerBytes += ConvertTo-Bytes $used
  }

  $hostBytes = [int64]0
  foreach ($process in @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -like "*$projectRoot*" -and $_.Name -in @('node.exe', 'pwsh.exe')
      })) {
    $runtime = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $runtime) {
      $hostBytes += [int64]$runtime.WorkingSet64
    }
  }

  $peakContainerBytes = [Math]::Max($peakContainerBytes, $containerBytes)
  $peakHostBytes = [Math]::Max($peakHostBytes, $hostBytes)
  $sampleRows += [ordered]@{
    at = [DateTimeOffset]::UtcNow.ToString('o')
    containerBytes = $containerBytes
    hostProcessBytes = $hostBytes
  }
  if ($sample -lt $Samples) {
    Start-Sleep -Seconds $IntervalSeconds
  }
}

$uniqueImageIds = @(
  $containerIds |
    ForEach-Object { (& docker inspect --format '{{.Image}}' $_).Trim() } |
    Sort-Object -Unique
)
$imageBytes = [int64]0
foreach ($imageId in $uniqueImageIds) {
  $imageBytes += [int64]((& docker image inspect --format '{{.Size}}' $imageId).Trim())
}

$volumeNames = @(& docker volume ls --filter 'label=com.docker.compose.project=queueforge' --format '{{.Name}}')
$volumeBytes = [int64]0
foreach ($volumeName in $volumeNames) {
  $measurementOutput = @(& docker run --rm --read-only --network none --cap-drop ALL --cap-add DAC_READ_SEARCH --security-opt no-new-privileges `
      --mount "type=volume,src=$volumeName,dst=/data,readonly" postgres:17.11-alpine `
      sh -c 'du -sb /data | cut -f1')
  if ($LASTEXITCODE -ne 0 -or $measurementOutput.Count -ne 1) {
    throw "Unable to measure QueueForge volume '$volumeName' safely."
  }
  $measured = ([string]$measurementOutput[0]).Trim()
  if ($measured -match '^\d+$') {
    $volumeBytes += [int64]$measured
  }
}

$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
if ($baseline.formatVersion -ne 2 -or $baseline.dockerSizeUnits -ne 'si-and-iec') {
  throw "The resource baseline uses legacy Docker size units. Remove it and run 'pwsh scripts/measure-resources.ps1 -CaptureBaseline' before building or starting the full profile."
}
$baselineTotal = Get-SnapshotTotalBytes $baseline.docker
$currentTotal = Get-SnapshotTotalBytes $dockerDisk
$dockerDelta = [Math]::Max([int64]0, $currentTotal - $baselineTotal)
$dockerCategoryDeltas = [ordered]@{}
foreach ($category in @('Images', 'Containers', 'Local Volumes', 'Build Cache')) {
  $baselineCategory = $baseline.docker.PSObject.Properties[$category].Value
  $currentCategory = $dockerDisk[$category]
  $dockerCategoryDeltas[$category] = [int64]$currentCategory.sizeBytes - [int64]$baselineCategory.sizeBytes
}
$attributedDisk = $imageBytes + $volumeBytes
$gitDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.git'))
$projectBytes = [int64]0
foreach ($file in Get-ChildItem -LiteralPath $projectRoot -Recurse -Force -File) {
  if (-not $file.FullName.StartsWith($gitDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    $projectBytes += [int64]$file.Length
  }
}
$memoryBudget = [int64](5GB)
$diskBudget = [int64](4GB)
$combinedDiskDelta = $projectBytes + $dockerDelta
$result = [ordered]@{
  measuredAt = [DateTimeOffset]::UtcNow.ToString('o')
  commit = (& git -C $projectRoot rev-parse HEAD).Trim()
  invocation = "pwsh scripts/measure-resources.ps1 -Samples $Samples -IntervalSeconds $IntervalSeconds -WorkloadLabel '$WorkloadLabel'"
  profile = 'docker-compose-full'
  workload = $WorkloadLabel
  baselineCapturedAt = $baseline.capturedAt
  baselineFormatVersion = $baseline.formatVersion
  dockerSizeUnits = $baseline.dockerSizeUnits
  dockerBaseline = $baseline.docker
  dockerCurrent = $dockerDisk
  dockerCategoryDeltaBytes = $dockerCategoryDeltas
  samples = $sampleRows
  peakContainerBytes = $peakContainerBytes
  peakHostProcessBytes = $peakHostBytes
  peakCombinedBytes = $peakContainerBytes + $peakHostBytes
  queueforgeImageBytesConservative = $imageBytes
  queueforgeVolumeBytes = $volumeBytes
  queueforgeAttributedDiskBytesConservative = $attributedDisk
  projectDirectoryBytes = $projectBytes
  dockerSystemDeltaBytes = $dockerDelta
  projectPlusDockerDeltaBytes = $combinedDiskDelta
  budgets = [ordered]@{
    memoryBytes = $memoryBudget
    diskBytes = $diskBudget
  }
  withinMemoryBudget = ($peakContainerBytes + $peakHostBytes) -lt $memoryBudget
  withinDiskBudget = $combinedDiskDelta -lt $diskBudget
  note = 'The release budget uses project-directory bytes plus the before/after Docker-system delta. Complete image sizes are also reported conservatively and may double-count shared layers.'
}

[System.IO.File]::WriteAllText(
  $resultPath,
  ($result | ConvertTo-Json -Depth 10),
  [System.Text.UTF8Encoding]::new($false)
)
$result | ConvertTo-Json -Depth 10

if (-not $result.withinMemoryBudget -or -not $result.withinDiskBudget) {
  exit 1
}
