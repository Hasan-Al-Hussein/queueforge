param(
  [string]$InputPath = "",
  [string]$OutputPath = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$defaultInput = Join-Path $projectRoot "demo-video\output\intermediate\product-demo-remotion-raw.mp4"
$defaultOutput = Join-Path $projectRoot "demo-video\output\product-demo.mp4"
$resolvedInput = if ($InputPath) { (Resolve-Path -LiteralPath $InputPath).Path } else { (Resolve-Path -LiteralPath $defaultInput).Path }
$resolvedOutput = if ($OutputPath) { [System.IO.Path]::GetFullPath($OutputPath) } else { $defaultOutput }
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
$loudnessReportPath = Join-Path $outputDirectory "audio-loudness-report.json"
$targetIntegratedLoudness = -16.8
$targetTruePeak = -2.2
$targetLoudnessRange = 11

if (-not (Test-Path -LiteralPath $resolvedInput -PathType Leaf)) {
  throw "Source render not found: $resolvedInput"
}

if ((Test-Path -LiteralPath $resolvedOutput) -and -not $Force) {
  throw "Output already exists: $resolvedOutput. Pass -Force only when replacing a reviewed local artifact."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$compositorPackage = Get-ChildItem -LiteralPath (Join-Path $projectRoot "node_modules\.pnpm") -Directory |
  Where-Object { $_.Name -like "@remotion+compositor-win32-x64-msvc@4.0.518*" } |
  Select-Object -First 1

if (-not $compositorPackage) {
  throw "The Remotion Windows compositor package is not installed. Run pnpm install first."
}

$ffmpeg = Join-Path $compositorPackage.FullName "node_modules\@remotion\compositor-win32-x64-msvc\ffmpeg.exe"
$temporaryOutput = Join-Path $outputDirectory (([System.IO.Path]::GetRandomFileName()) + ".mp4")
$temporaryReport = Join-Path $outputDirectory (([System.IO.Path]::GetRandomFileName()) + ".json")

function Get-LoudnessMeasurement {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MediaPath,
    [switch]$Downmix
  )

  $panFilter = if ($Downmix) { "pan=mono|c0=0.5*c0+0.5*c1," } else { "" }
  $filter = "${panFilter}loudnorm=I=${targetIntegratedLoudness}:TP=${targetTruePeak}:LRA=${targetLoudnessRange}:print_format=json"
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $measurementOutput = (& $ffmpeg -hide_banner -nostats -i $MediaPath -vn -af $filter -f null NUL 2>&1) | Out-String
  $measurementExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorActionPreference

  if ($measurementExitCode -ne 0) {
    throw "FFmpeg loudness analysis failed with exit code $measurementExitCode.`n$measurementOutput"
  }

  $measurementMatches = [regex]::Matches(
    $measurementOutput,
    '(?s)\{\s*"input_i"\s*:.*?"target_offset"\s*:\s*"[^"]+"\s*\}'
  )
  if ($measurementMatches.Count -eq 0) {
    throw "FFmpeg did not return a parseable loudness measurement.`n$measurementOutput"
  }

  return $measurementMatches[$measurementMatches.Count - 1].Value | ConvertFrom-Json
}

try {
  $inputMeasurement = Get-LoudnessMeasurement -MediaPath $resolvedInput -Downmix
  $loudnormFilter = @(
    "pan=mono|c0=0.5*c0+0.5*c1",
    "loudnorm=I=${targetIntegratedLoudness}:TP=${targetTruePeak}:LRA=${targetLoudnessRange}:measured_I=$($inputMeasurement.input_i):measured_TP=$($inputMeasurement.input_tp):measured_LRA=$($inputMeasurement.input_lra):measured_thresh=$($inputMeasurement.input_thresh):offset=$($inputMeasurement.target_offset):linear=true:print_format=summary"
  ) -join ','

  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $ffmpeg `
    -hide_banner `
    -y `
    -i $resolvedInput `
    -vf "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p" `
    -c:v libx264 `
    -preset medium `
    -crf 18 `
    -pix_fmt yuv420p `
    -color_range tv `
    -colorspace bt709 `
    -color_primaries bt709 `
    -color_trc bt709 `
    -af $loudnormFilter `
    -ac 1 `
    -ar 48000 `
    -c:a aac `
    -b:a 192k `
    -movflags +faststart `
    $temporaryOutput
  $ErrorActionPreference = $savedErrorActionPreference

  if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg failed with exit code $LASTEXITCODE."
  }

  $outputMeasurement = Get-LoudnessMeasurement -MediaPath $temporaryOutput
  [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    target = [ordered]@{
      integratedLoudnessLufs = $targetIntegratedLoudness
      truePeakDbtp = $targetTruePeak
      loudnessRangeLu = $targetLoudnessRange
    }
    firstPass = $inputMeasurement
    finalMeasurement = $outputMeasurement
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryReport -Encoding utf8

  Move-Item -LiteralPath $temporaryOutput -Destination $resolvedOutput -Force:$Force
  Move-Item -LiteralPath $temporaryReport -Destination $loudnessReportPath -Force
  Write-Output "Finalized QueueForge video: $resolvedOutput"
  Write-Output "Loudness report: $loudnessReportPath"
} finally {
  $ErrorActionPreference = "Stop"
  if (Test-Path -LiteralPath $temporaryOutput) {
    Remove-Item -LiteralPath $temporaryOutput -Force
  }
  if (Test-Path -LiteralPath $temporaryReport) {
    Remove-Item -LiteralPath $temporaryReport -Force
  }
}
