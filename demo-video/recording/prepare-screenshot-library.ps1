param(
  [string]$StagingRoot = "output/playwright/queueforge-media-2026-08-31-v1/staging",
  [string]$Revision = "e4de0d2-b17918e5"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$stagingPath = (Resolve-Path (Join-Path $repoRoot $StagingRoot)).Path
$finalRoot = Join-Path $repoRoot "docs/media/screenshots/final-$Revision"
$readmeMediaRoot = Join-Path $repoRoot "docs/media/readme"
$remotionPublic = Join-Path $repoRoot "demo-video/remotion/public"

$steps = @(
  @{ Number = "01"; Slug = "admin-overview"; Source = "02-admin-overview"; Alt = "QueueForge administrator overview showing the Proof Spine and the current approval workload." },
  @{ Number = "02"; Slug = "role-boundaries"; Source = "03-team"; Alt = "People and access table showing separate QueueForge workspace roles." },
  @{ Number = "03"; Slug = "delivery-connection"; Source = "04-delivery"; Alt = "Signed delivery connection configuration and retained delivery activity." },
  @{ Number = "04"; Slug = "published-request-type"; Source = "05-workflow-editor"; Alt = "Published Expense review request type in the QueueForge workflow editor." },
  @{ Number = "05"; Slug = "submit-expense-review"; Source = "06-operator-intake"; Alt = "Operator completing the human-readable Expense review request form." },
  @{ Number = "06"; Slug = "waiting-for-approval"; Source = "07-request-pending"; Alt = "Expense review request safely waiting for an independent approval decision." },
  @{ Number = "07"; Slug = "approver-review"; Source = "08-approver-inbox"; Alt = "Approver inbox showing the separate review step for the Expense review request." },
  @{ Number = "08"; Slug = "processing-completed"; Source = "09-request-completed"; Alt = "Completed Expense review request with durable processing status and retained history." },
  @{ Number = "09"; Slug = "delivery-history"; Source = "10-delivery-history"; Alt = "Delivery history filtered to the signed result accepted by the local receiver." },
  @{ Number = "10"; Slug = "receiver-accepted"; Source = "11-receiver-accepted"; Alt = "Accepted delivery detail showing the receiver response and retained attempt evidence." },
  @{ Number = "11"; Slug = "requester-notifications"; Source = "12-notifications"; Alt = "Requester notifications linked back to the completed Expense review request." },
  @{ Number = "12"; Slug = "correlated-activity"; Source = "13-activity"; Alt = "Correlated QueueForge activity log explaining who changed what and when." },
  @{ Number = "13"; Slug = "cross-tenant-blocked"; Source = "14-cross-tenant"; Alt = "QueueForge boundary state blocking access to a record from another workspace." },
  @{ Number = "14"; Slug = "processing-recovery"; Source = "15-processing-recovery"; Alt = "Processing health view showing retry and recovery visibility for durable work." }
)

$mobile = @(
  @{ Name = "01-login-light-390x844.png"; Source = "01-login-light-390x844.png"; Alt = "QueueForge mobile sign-in with the compact Attestation Forge." },
  @{ Name = "02-navigation-light-390x844.png"; Source = "00-navigation-light-390x844.png"; Alt = "QueueForge mobile navigation drawer and workspace context." },
  @{ Name = "03-admin-overview-light-390x844.png"; Source = "02-admin-overview-light-390x844.png"; Alt = "QueueForge administrator overview recomposed for a 390 pixel viewport." },
  @{ Name = "04-submit-expense-light-390x844.png"; Source = "05-submit-expense-light-390x844.png"; Alt = "Expense review request form on mobile." },
  @{ Name = "05-pending-approval-light-390x844.png"; Source = "06-pending-approval-light-390x844.png"; Alt = "Pending approval request detail on mobile." },
  @{ Name = "06-completed-result-light-390x844.png"; Source = "08-completed-result-light-390x844.png"; Alt = "Completed request result on mobile." },
  @{ Name = "07-processing-recovery-light-390x844.png"; Source = "14-processing-recovery-light-390x844.png"; Alt = "Processing recovery view on mobile." },
  @{ Name = "08-login-dark-390x844.png"; Source = "01-login-dark-390x844.png"; Alt = "QueueForge dark mobile sign-in." }
)

foreach ($theme in @("light", "dark")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $finalRoot "$theme/desktop") | Out-Null
}
New-Item -ItemType Directory -Force -Path (Join-Path $finalRoot "light/mobile") | Out-Null
New-Item -ItemType Directory -Force -Path $readmeMediaRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $remotionPublic "screenshots/light") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $remotionPublic "screenshots/dark") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $remotionPublic "screenshots/mobile") | Out-Null

$manifestRows = [System.Collections.Generic.List[object]]::new()

foreach ($step in $steps) {
  foreach ($theme in @("light", "dark")) {
    $sourceName = "$($step.Source)-$theme-1440x900.png"
    $sourcePath = Join-Path $stagingPath "desktop/$sourceName"
    $finalName = "$($step.Number)-$($step.Slug).png"
    $destination = Join-Path $finalRoot "$theme/desktop/$finalName"
    Copy-Item -LiteralPath $sourcePath -Destination $destination -Force
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $remotionPublic "screenshots/$theme/$finalName") -Force
    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromFile($destination)
    try {
      $manifestRows.Add([PSCustomObject]@{
        Step = $step.Number
        Theme = $theme
        Viewport = "$($image.Width)x$($image.Height)"
        File = "docs/media/screenshots/final-$Revision/$theme/desktop/$finalName"
        Bytes = (Get-Item -LiteralPath $destination).Length
        Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
        Alt = $step.Alt
      })
    } finally {
      $image.Dispose()
    }
  }
}

foreach ($item in $mobile) {
  $sourcePath = Join-Path $stagingPath "mobile/$($item.Source)"
  $destination = Join-Path $finalRoot "light/mobile/$($item.Name)"
  Copy-Item -LiteralPath $sourcePath -Destination $destination -Force
  Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $remotionPublic "screenshots/mobile/$($item.Name)") -Force
  $image = [System.Drawing.Image]::FromFile($destination)
  try {
    $manifestRows.Add([PSCustomObject]@{
      Step = "M"
      Theme = if ($item.Name -like "*-dark-*") { "dark" } else { "light" }
      Viewport = "$($image.Width)x$($image.Height)"
      File = "docs/media/screenshots/final-$Revision/light/mobile/$($item.Name)"
      Bytes = (Get-Item -LiteralPath $destination).Length
      Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
      Alt = $item.Alt
    })
  } finally {
    $image.Dispose()
  }
}

function New-ContactSheet {
  param(
    [Parameter(Mandatory)] [string[]]$Paths,
    [Parameter(Mandatory)] [string[]]$Labels,
    [Parameter(Mandatory)] [string]$OutputPath,
    [int]$Columns = 3,
    [int]$ThumbWidth = 432,
    [int]$ThumbHeight = 270
  )

  Add-Type -AssemblyName System.Drawing
  $labelHeight = 42
  $gap = 18
  $outer = 24
  $rows = [Math]::Ceiling($Paths.Count / $Columns)
  $width = ($outer * 2) + ($Columns * $ThumbWidth) + (($Columns - 1) * $gap)
  $height = ($outer * 2) + ($rows * ($ThumbHeight + $labelHeight)) + (($rows - 1) * $gap)
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#071216"))
  $font = [System.Drawing.Font]::new("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
  $labelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#E4A84B"))
  $panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#0D1A20"))
  $rulePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#294047"), 1)

  try {
    for ($index = 0; $index -lt $Paths.Count; $index++) {
      $column = $index % $Columns
      $row = [Math]::Floor($index / $Columns)
      $x = $outer + ($column * ($ThumbWidth + $gap))
      $y = $outer + ($row * ($ThumbHeight + $labelHeight + $gap))
      $graphics.FillRectangle($panelBrush, $x, $y, $ThumbWidth, $ThumbHeight + $labelHeight)
      $source = [System.Drawing.Image]::FromFile($Paths[$index])
      try {
        $graphics.DrawImage($source, [System.Drawing.Rectangle]::new($x, $y, $ThumbWidth, $ThumbHeight))
      } finally {
        $source.Dispose()
      }
      $graphics.DrawRectangle($rulePen, $x, $y, $ThumbWidth, $ThumbHeight + $labelHeight)
      $graphics.DrawString($Labels[$index], $font, $labelBrush, [System.Drawing.PointF]::new($x + 12, $y + $ThumbHeight + 10))
    }
    $outputDirectory = Split-Path -Parent $OutputPath
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $rulePen.Dispose()
    $panelBrush.Dispose()
    $labelBrush.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$labels = $steps | ForEach-Object { "$($_.Number)  $($_.Slug -replace '-', ' ')" }
foreach ($theme in @("light", "dark")) {
  $paths = $steps | ForEach-Object { Join-Path $finalRoot "$theme/desktop/$($_.Number)-$($_.Slug).png" }
  New-ContactSheet -Paths $paths -Labels $labels -OutputPath (Join-Path $readmeMediaRoot "queueforge-$theme-contact-sheet.png")
}

$mobilePaths = $mobile | ForEach-Object { Join-Path $finalRoot "light/mobile/$($_.Name)" }
$mobileLabels = $mobile | ForEach-Object { $_.Name -replace '\.png$', '' -replace '-', ' ' }
New-ContactSheet -Paths $mobilePaths -Labels $mobileLabels -OutputPath (Join-Path $readmeMediaRoot "queueforge-mobile-contact-sheet.png") -Columns 4 -ThumbWidth 195 -ThumbHeight 422

$header = @"
# QueueForge screenshot manifest

- Source commit: `e4de0d27801d11b031756ca2d09ae05e54cac78c`
- Working-tree fingerprint: `b17918e54d28889967bd30427952f99b2c86979f59eaa49ae985f248a57d6027`
- Capture date: 2026-08-31
- Desktop viewport: 1440 × 900
- Mobile viewport: 390 × 844
- Scenario: deterministic synthetic Expense review in the local Foundry Demonstration workspace
- Scope: loopback-only QueueForge demonstration

| Step | Theme | Viewport | File | Bytes | SHA-256 | Alt text |
| --- | --- | --- | --- | ---: | --- | --- |
"@

$rows = $manifestRows | ForEach-Object {
  "| $($_.Step) | $($_.Theme) | $($_.Viewport) | ``$($_.File)`` | $($_.Bytes) | ``$($_.Sha256)`` | $($_.Alt) |"
}

$manifestPath = Join-Path $repoRoot "docs/media/screenshots/manifest.md"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
Set-Content -LiteralPath $manifestPath -Value ($header + ($rows -join "`n") + "`n") -Encoding UTF8

$manifestRows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $finalRoot "manifest.json") -Encoding UTF8
Write-Output "Prepared $($manifestRows.Count) screenshots at $finalRoot"
Write-Output "Manifest: $manifestPath"
Write-Output "Contact sheets: $readmeMediaRoot"
