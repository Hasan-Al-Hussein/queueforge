[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetPath = Join-Path $projectRoot '.env'

function New-Base64UrlToken {
  param([int]$ByteCount = 48)

  $bytes = [byte[]]::new($ByteCount)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-Base64Key {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

if ((Test-Path -LiteralPath $targetPath) -and -not $Force) {
  $existingLines = @(Get-Content -LiteralPath $targetPath)
  $existingValues = @{}
  foreach ($line in $existingLines) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $existingValues[$Matches[1]] = $Matches[2]
    }
  }
  $additions = [System.Collections.Generic.List[string]]::new()
  if (-not $existingValues.ContainsKey('NEXT_PUBLIC_CSRF_COOKIE_NAME')) {
    $csrfCookieName = if ($existingValues.ContainsKey('CSRF_COOKIE_NAME')) {
      $existingValues['CSRF_COOKIE_NAME']
    }
    else {
      'qf_csrf'
    }
    $additions.Add("NEXT_PUBLIC_CSRF_COOKIE_NAME=$csrfCookieName")
  }
  if (-not $existingValues.ContainsKey('METRICS_TOKEN')) {
    $additions.Add("METRICS_TOKEN=$(New-Base64UrlToken 48)")
  }
  if ($additions.Count -gt 0) {
    $existingText = [System.IO.File]::ReadAllText($targetPath)
    $separator = if ($existingText.EndsWith("`n")) { '' } else { "`r`n" }
    $appended = $separator + ($additions -join "`r`n") + "`r`n"
    [System.IO.File]::AppendAllText($targetPath, $appended, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Updated .env with $($additions.Count) missing QueueForge variable(s); existing values were preserved."
  }
  else {
    Write-Host '.env already contains every generated QueueForge variable; leaving it unchanged.'
  }
  exit 0
}

$postgresOwnerPassword = New-Base64UrlToken 32
$postgresAppPassword = New-Base64UrlToken 32
$redisPassword = New-Base64UrlToken 32
$jwtSecret = New-Base64UrlToken 48
$refreshPepper = New-Base64UrlToken 48
$metricsToken = New-Base64UrlToken 48
$webhookKey = New-Base64Key
$adminPassword = New-Base64UrlToken 24
$sinkSecret = New-Base64UrlToken 48
$sinkControlToken = New-Base64UrlToken 48

$content = @"
NODE_ENV=development
APP_MODE=local
API_HOST=127.0.0.1
API_PORT=3001
WEB_PORT=3100
WEB_ORIGIN=http://127.0.0.1:3100
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
NEXT_PUBLIC_GRAPHQL_URL=http://127.0.0.1:3001/graphql
POSTGRES_PORT=5432
POSTGRES_DB=queueforge
POSTGRES_OWNER_USER=queueforge_owner
POSTGRES_OWNER_PASSWORD=$postgresOwnerPassword
POSTGRES_APP_PASSWORD=$postgresAppPassword
# secretlint-disable
MIGRATION_DATABASE_URL=postgresql://queueforge_owner:$postgresOwnerPassword@127.0.0.1:5432/queueforge
DATABASE_URL=postgresql://queueforge_app:$postgresAppPassword@127.0.0.1:5432/queueforge
REDIS_PORT=6379
REDIS_PASSWORD=$redisPassword
REDIS_URL=redis://:$redisPassword@127.0.0.1:6379/0
TEST_POSTGRES_PORT=55432
TEST_REDIS_PORT=56379
TEST_MIGRATION_DATABASE_URL=postgresql://queueforge_owner:$postgresOwnerPassword@127.0.0.1:55432/queueforge_test
TEST_DATABASE_URL=postgresql://queueforge_app:$postgresAppPassword@127.0.0.1:55432/queueforge_test
# secretlint-enable
TEST_REDIS_URL=redis://:$redisPassword@127.0.0.1:56379/0
JWT_ACCESS_SECRET=$jwtSecret
JWT_ISSUER=queueforge-local
JWT_AUDIENCE=queueforge-api
ACCESS_TOKEN_TTL_SECONDS=600
REFRESH_TOKEN_TTL_SECONDS=604800
REFRESH_FAMILY_TTL_SECONDS=2592000
REFRESH_TOKEN_PEPPER=$refreshPepper
WEBHOOK_MASTER_KEY=$webhookKey
REFRESH_COOKIE_NAME=qf_refresh
CSRF_COOKIE_NAME=qf_csrf
NEXT_PUBLIC_CSRF_COOKIE_NAME=qf_csrf
COOKIE_SECURE=false
TRUST_PROXY=false
LOG_LEVEL=info
METRICS_TOKEN=$metricsToken
OUTBOUND_ALLOWED_HOSTS=127.0.0.1,localhost,webhook-sink
OUTBOUND_ALLOW_PRIVATE_NETWORKS=true
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_LEASE_SECONDS=30
WORKER_CONCURRENCY=4
WORKER_HEARTBEAT_SECONDS=10
REQUEST_JOB_TIMEOUT_MS=30000
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_CLOCK_SKEW_SECONDS=300
BOOTSTRAP_ADMIN_EMAIL=admin@queueforge.test
BOOTSTRAP_ADMIN_PASSWORD=$adminPassword
BOOTSTRAP_TENANT_SLUG=acme-demo
DEMO_WEBHOOK_TARGET_URL=http://127.0.0.1:3300/webhooks
SINK_HOST=127.0.0.1
SINK_PORT=3300
SINK_SECRET=$sinkSecret
SINK_CONTROL_TOKEN=$sinkControlToken
SINK_KEY_ID=local-v1
SINK_CLOCK_SKEW_SECONDS=300
"@

[System.IO.File]::WriteAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Generated .env with synthetic local-only secrets. Values were not printed.'
