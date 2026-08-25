[CmdletBinding()]
param(
  [Parameter()]
  [switch] $SkipTopology,

  [Parameter()]
  [switch] $KeepWorkspace
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$artifactDirectory = Join-Path $projectRoot 'artifacts\verification'
$artifactPath = Join-Path $artifactDirectory 'clean-start.json'
$builderCpuCount = [Math]::Min(4, [Environment]::ProcessorCount)
$builderCpuSet = if ($builderCpuCount -eq 1) { '0' } else { "0-$($builderCpuCount - 1)" }
$builderMemoryLimit = '2560m'
$composeParallelLimit = '1'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Executable,

    [Parameter()]
    [string[]] $Arguments = @()
  )

  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Executable exited with code $LASTEXITCODE."
  }
}

function Test-BuildxBuilderArtifactsAbsent {
  param([string] $Name)

  $containerName = "buildx_buildkit_${Name}0"
  $volumeName = "${containerName}_state"
  & docker buildx inspect $Name *> $null
  $builderExists = $LASTEXITCODE -eq 0
  & docker container inspect $containerName *> $null
  $containerExists = $LASTEXITCODE -eq 0
  & docker volume inspect $volumeName *> $null
  $volumeExists = $LASTEXITCODE -eq 0
  return -not ($builderExists -or $containerExists -or $volumeExists)
}

function Remove-BuildxBuilder {
  param([string] $Name)

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    & docker buildx rm $Name
    $removeExitCode = $LASTEXITCODE
    for ($check = 1; $check -le 15; $check++) {
      if (Test-BuildxBuilderArtifactsAbsent $Name) {
        if ($removeExitCode -ne 0) {
          Write-Warning "Docker reported a builder-removal error, but all exact builder artifacts are absent."
        }
        return
      }
      Start-Sleep -Seconds 2
    }
  }
  throw "Unable to remove disposable Buildx builder '$Name' and its exact state artifacts."
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  }
  finally {
    $listener.Stop()
  }
}

function Set-EnvironmentValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [string] $Value
  )

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.AddRange([string[]](Get-Content -LiteralPath $Path))
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
      $lines[$index] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines.Add("$Name=$Value")
  }
  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Test-HttpReady {
  param([string] $Uri)

  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return
      }
    }
    catch {
      if ($attempt -eq 60) {
        throw "Timed out waiting for $Uri."
      }
    }
    Start-Sleep -Seconds 1
  }
}

$dirty = @(& git -C $projectRoot status --porcelain)
if ($dirty.Count -gt 0) {
  throw 'Clean-start proof requires a clean tracked revision. Commit or intentionally remove local changes first.'
}

$commit = (& git -C $projectRoot rev-parse HEAD).Trim()
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$temporaryRoot = Join-Path $temporaryBase "queueforge-clean-$runId"
$archivePath = Join-Path $temporaryRoot 'queueforge.zip'
$archiveWorkspace = Join-Path $temporaryRoot 'workspace'
$composeProject = "queueforge-clean-$runId"
$builderName = "$composeProject-builder"
$started = $false
$builderCreated = $false
$success = $false
$result = $null
$failureRecord = $null
$environmentBackup = @{}
$environmentOverridden = $false
$ownedImageReferences = @()

[System.IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($archiveWorkspace) | Out-Null

try {
  Invoke-Checked git @('-C', $projectRoot, 'archive', '--format=zip', "--output=$archivePath", $commit)
  Expand-Archive -LiteralPath $archivePath -DestinationPath $archiveWorkspace

  Push-Location -LiteralPath $archiveWorkspace
  try {
    Invoke-Checked corepack @('pnpm', 'install', '--frozen-lockfile')
    Invoke-Checked corepack @('pnpm', 'bootstrap')
    Invoke-Checked corepack @('pnpm', 'env:generate')
    if (-not $SkipTopology) {
      Invoke-Checked corepack @('pnpm', 'exec', 'playwright', 'install', 'chromium')
    }

    $usedPorts = [System.Collections.Generic.HashSet[int]]::new()
    $ports = @()
    while ($ports.Count -lt 5) {
      $candidate = Get-FreePort
      if ($usedPorts.Add($candidate)) {
        $ports += $candidate
      }
    }
    $apiPort, $webPort, $sinkPort, $postgresPort, $redisPort = $ports
    $environmentPath = Join-Path $archiveWorkspace '.env'
    Set-EnvironmentValue $environmentPath 'API_PORT' $apiPort
    Set-EnvironmentValue $environmentPath 'WEB_PORT' $webPort
    Set-EnvironmentValue $environmentPath 'SINK_PORT' $sinkPort
    Set-EnvironmentValue $environmentPath 'POSTGRES_PORT' $postgresPort
    Set-EnvironmentValue $environmentPath 'REDIS_PORT' $redisPort
    Set-EnvironmentValue $environmentPath 'WEB_ORIGIN' "http://127.0.0.1:$webPort"
    Set-EnvironmentValue $environmentPath 'NEXT_PUBLIC_API_URL' "http://127.0.0.1:$apiPort"
    Set-EnvironmentValue $environmentPath 'NEXT_PUBLIC_GRAPHQL_URL' "http://127.0.0.1:$apiPort/graphql"
    Set-EnvironmentValue $environmentPath 'QUEUEFORGE_PERSISTENCE_IMAGE' "$composeProject-persistence:local"

    $temporaryEnvironment = [ordered]@{}
    foreach ($line in Get-Content -LiteralPath $environmentPath) {
      if ($line -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') {
        continue
      }
      $pair = $line.Split('=', 2)
      $temporaryEnvironment[$pair[0]] = $pair[1]
    }
    $temporaryEnvironment['E2E_BASE_URL'] = "http://127.0.0.1:$webPort"
    $temporaryEnvironment['E2E_API_URL'] = "http://127.0.0.1:$apiPort"
    $temporaryEnvironment['E2E_SINK_URL'] = "http://127.0.0.1:$sinkPort"
    $temporaryEnvironment['COMPOSE_PARALLEL_LIMIT'] = $composeParallelLimit
    if (-not $SkipTopology) {
      $temporaryEnvironment['BUILDX_BUILDER'] = $builderName
    }
    foreach ($name in $temporaryEnvironment.Keys) {
      $environmentBackup[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $temporaryEnvironment[$name], 'Process')
    }
    $environmentOverridden = $true

    Invoke-Checked docker @('compose', '-p', $composeProject, '--profile', 'full', 'config', '--quiet')
    $ownedImageReferences = @(
      & docker compose -p $composeProject --profile full config --images |
        Where-Object {
          $_ -match "^$([regex]::Escape($composeProject))-(?:api|worker|web|webhook-sink|persistence)(?::|$)"
        } |
        Sort-Object -Unique
    )
    if (-not $SkipTopology) {
      Invoke-Checked docker @(
        'buildx', 'create', '--name', $builderName, '--driver', 'docker-container',
        '--driver-opt', "cpuset-cpus=$builderCpuSet",
        '--driver-opt', "memory=$builderMemoryLimit"
      )
      $builderCreated = $true
      $started = $true
      Invoke-Checked docker @('buildx', 'inspect', $builderName, '--bootstrap')
      Invoke-Checked docker @(
        'compose', '-p', $composeProject, '--profile', 'full',
        'build', '--builder', $builderName
      )
      foreach ($imageReference in $ownedImageReferences) {
        Invoke-Checked docker @('image', 'inspect', '--format', '{{.Id}}', $imageReference) | Out-Null
      }
      Invoke-Checked docker @(
        'compose', '-p', $composeProject, '--profile', 'full',
        'up', '-d', '--no-build', '--wait', '--wait-timeout', '240'
      )
      Test-HttpReady "http://127.0.0.1:$apiPort/api/v1/health/ready"
      Test-HttpReady "http://127.0.0.1:$sinkPort/health"
      Test-HttpReady "http://127.0.0.1:$webPort"
      Invoke-Checked corepack @('pnpm', 'test:e2e')
    }

    $result = [ordered]@{
      verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
      commit = $commit
      frozenInstall = 'passed'
      workspaceBuild = 'passed'
      composeConfig = 'passed'
      topology = if ($SkipTopology) { 'skipped-by-operator' } else { 'healthy' }
      representativeJourney = if ($SkipTopology) { 'skipped-by-operator' } else { 'passed' }
      composeProject = $composeProject
      buildResourcePolicy = [ordered]@{
        builderCpuSet = $builderCpuSet
        builderMemoryLimit = $builderMemoryLimit
        composeParallelLimit = [int]$composeParallelLimit
      }
      origins = [ordered]@{
        api = "http://127.0.0.1:$apiPort"
        web = "http://127.0.0.1:$webPort"
        sink = "http://127.0.0.1:$sinkPort"
      }
    }
    $success = $true
  }
  finally {
    Pop-Location
  }
}
catch {
  $failureRecord = $_
}
finally {
  try {
    try {
      if ($started) {
        $containerIds = @(& docker ps -aq --filter "label=com.docker.compose.project=$composeProject")
        foreach ($containerId in $containerIds) {
          $label = (& docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' $containerId).Trim()
          if ($label -ne $composeProject) {
            throw "Refusing cleanup because container $containerId is not owned by $composeProject."
          }
        }
        $volumeNames = @(& docker volume ls --filter "label=com.docker.compose.project=$composeProject" --format '{{.Name}}')
        foreach ($volumeName in $volumeNames) {
          $label = (& docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' $volumeName).Trim()
          if ($label -ne $composeProject) {
            throw "Refusing cleanup because volume $volumeName is not owned by $composeProject."
          }
        }
        Push-Location -LiteralPath $archiveWorkspace
        try {
          Invoke-Checked docker @(
            'compose', '-p', $composeProject, '--profile', 'full',
            'down', '-v', '--remove-orphans', '--rmi', 'local'
          )
        }
        finally {
          Pop-Location
        }

        foreach ($imageReference in $ownedImageReferences) {
          if ($imageReference -notmatch "^$([regex]::Escape($composeProject))-") {
            throw "Refusing cleanup for unexpected image reference '$imageReference'."
          }
          $imageId = (& docker image inspect --format '{{.Id}}' $imageReference 2>$null).Trim()
          if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageId)) {
            continue
          }
          foreach ($containerId in @(& docker ps -aq --filter "ancestor=$imageId")) {
            $label = (& docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' $containerId).Trim()
            if ($label -ne $composeProject) {
              throw "Refusing to remove image $imageReference because container $containerId is not owned by $composeProject."
            }
          }
          Invoke-Checked docker @('image', 'rm', $imageReference)
        }
      }
    }
    catch {
      if ($null -eq $failureRecord) {
        $failureRecord = $_
      }
      else {
        Write-Warning "Clean-start cleanup also failed: $($_.Exception.Message)"
      }
    }

    if ($builderCreated) {
      try {
        if ($builderName -notmatch '^queueforge-clean-[a-f0-9]{10}-builder$') {
          throw "Refusing cleanup for unexpected builder '$builderName'."
        }
        Remove-BuildxBuilder $builderName
      }
      catch {
        if ($null -eq $failureRecord) {
          $failureRecord = $_
        }
        else {
          Write-Warning "Clean-start builder cleanup also failed: $($_.Exception.Message)"
        }
      }
      finally {
        $builderCreated = $false
      }
    }

    if ($null -eq $failureRecord -and -not $KeepWorkspace -and (Test-Path -LiteralPath $temporaryRoot)) {
      $resolvedTarget = [System.IO.Path]::GetFullPath($temporaryRoot)
      if (
        -not $resolvedTarget.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolvedTarget) -notmatch '^queueforge-clean-[a-f0-9]{10}$'
      ) {
        $failureRecord = [System.Management.Automation.RuntimeException]::new(
          "Refusing to remove unexpected temporary path '$resolvedTarget'."
        )
      }
      else {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
      }
    }
    elseif (Test-Path -LiteralPath $temporaryRoot) {
      Write-Warning "Clean-start workspace retained for failure evidence: $temporaryRoot"
      Write-Warning 'The retained .env contains generated local-only credentials; do not publish the workspace.'
    }
  }
  finally {
    if ($environmentOverridden) {
      foreach ($name in $environmentBackup.Keys) {
        [Environment]::SetEnvironmentVariable($name, $environmentBackup[$name], 'Process')
      }
    }
  }
}

if ($null -ne $failureRecord) {
  throw $failureRecord
}

if ($success) {
  [System.IO.File]::WriteAllText(
    $artifactPath,
    ($result | ConvertTo-Json -Depth 6),
    [System.Text.UTF8Encoding]::new($false)
  )
  $result | ConvertTo-Json -Depth 6
}
