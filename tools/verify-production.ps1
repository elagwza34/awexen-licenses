# One-shot production smoke test against a deployed Fly app. Verifies the whole
# chain end to end: health, database, signing key, login with the real seeded
# credentials, and a few authenticated reads.
#
#   pwsh -File tools/verify-production.ps1 -BaseUrl https://api.awexen.com/api/v1
param(
  [string]$BaseUrl = 'https://owneradmin-api.fly.dev/api/v1',
  [string]$SecretsFile
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $SecretsFile) { $SecretsFile = Join-Path $repoRoot '.deploy-secrets.local' }
if (-not (Test-Path $SecretsFile)) { throw "Missing $SecretsFile" }

$kv = @{}
Get-Content -LiteralPath $SecretsFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $kv[$matches[1]] = $matches[2] }
}

$pass = 0; $fail = 0
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; "  PASS  $name" }
  else { $script:fail++; "  FAIL  $name $detail" }
}

Write-Host "`nVerifying $BaseUrl`n"

try {
  $h = Invoke-WebRequest "$BaseUrl/health" -UseBasicParsing -TimeoutSec 30
  $hj = $h.Content | ConvertFrom-Json
  Check 'health returns 200' ($h.StatusCode -eq 200) "got $($h.StatusCode)"
  Check 'status is ok' ($hj.status -eq 'ok') "got '$($hj.status)'"
  Check 'database is up' ($hj.database -eq 'up') "got '$($hj.database)'"
  Check 'signing key loaded' ($hj.signingKeyLoaded -eq $true) "got '$($hj.signingKeyLoaded)'"
} catch {
  Check 'health returns 200' $false $_.Exception.Message
}

$token = $null
try {
  $body = @{ email = $kv['SEED_ADMIN_EMAIL']; password = $kv['SEED_ADMIN_PASSWORD'] } |
    ConvertTo-Json -Compress
  $l = Invoke-WebRequest "$BaseUrl/auth/login" -Method Post -Body $body `
    -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
  $lj = $l.Content | ConvertFrom-Json
  Check 'login returns 200' ($l.StatusCode -eq 200) "got $($l.StatusCode)"
  Check 'login email matches the seed' ($lj.admin.email -eq $kv['SEED_ADMIN_EMAIL'])
  $token = $lj.tokens.accessToken
  Check 'an access token was issued' ([bool]$token)
} catch {
  Check 'login returns 200' $false $_.Exception.Message
}

if ($token) {
  $auth = @{ Authorization = "Bearer $token" }
  try {
    # auth/me returns the admin DTO itself, not a { admin, permissions } wrapper.
    $m = (Invoke-WebRequest "$BaseUrl/auth/me" -Headers $auth -UseBasicParsing -TimeoutSec 30).Content |
      ConvertFrom-Json
    Check 'auth/me returns the profile' ($m.email -eq $kv['SEED_ADMIN_EMAIL']) "got '$($m.email)'"
    # An empty permission set would render a panel where every button is dead.
    Check 'the owner has permissions' ($m.permissions.Count -gt 0) "count $($m.permissions.Count)"
    Check 'the owner has the SUPER_ADMIN role' ($m.roles -contains 'SUPER_ADMIN') "roles: $($m.roles -join ', ')"
  } catch {
    Check 'auth/me returns the profile' $false $_.Exception.Message
  }
  foreach ($p in 'plans', 'releases', 'settings', 'payments/summary') {
    try {
      $r = Invoke-WebRequest "$BaseUrl/$p" -Headers $auth -UseBasicParsing -TimeoutSec 30
      Check "GET $p" ($r.StatusCode -eq 200) "got $($r.StatusCode)"
    } catch {
      Check "GET $p" $false $_.Exception.Message
    }
  }
}

Write-Host ''
Write-Host ('=' * 46)
Write-Host "  $pass passed, $fail failed"
Write-Host ('=' * 46)
if ($fail) { exit 1 }
