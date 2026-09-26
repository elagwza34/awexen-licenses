<#
.SYNOPSIS
  Prepares the Neon production database: tests the connection, applies
  migrations, and seeds the first SUPER_ADMIN.

.DESCRIPTION
  This script generates the password pepper and the bootstrap admin password
  ONCE and writes them to `.deploy-secrets.local` (git-ignored). It then seeds
  the database with that exact pepper.

  The ordering matters and is the whole point of this script: the seed hashes
  the admin password as `password::pepper`. If the pepper used for seeding
  differs from the pepper the running application uses, verifyPassword() can
  never match the stored hash and the owner account is silently unable to sign
  in. So the pepper is generated here, used for the seed, and later uploaded to
  Fly by set-fly-secrets.ps1, which reads this same file.

  Nothing is printed except masked URLs, and the credentials land only in the
  git-ignored local file.

.PARAMETER ConnectionFile
  File holding the Neon connection strings.

.PARAMETER AdminEmail
  Email for the first SUPER_ADMIN.

.EXAMPLE
  .\tools\prepare-neon.ps1 -AdminEmail 'elagwza34@gmail.com'
#>
[CmdletBinding()]
param(
  [string]$ConnectionFile,
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [string]$SecretsFile
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repoRoot 'backend'

# $PSScriptRoot is still empty while param() defaults are being evaluated, so
# the default paths are resolved here rather than inline above.
if (-not $ConnectionFile) { $ConnectionFile = Join-Path $repoRoot '.env.production.local.txt' }
if (-not $SecretsFile) { $SecretsFile = Join-Path $repoRoot '.deploy-secrets.local' }

if (-not (Test-Path $ConnectionFile)) {
  throw "Connection file not found: $ConnectionFile"
}

# ---- 1. Extract the pooled URL ----
# Neon shows a connection panel whose copy button yields a bare URL, sometimes
# with the API/JWKS links underneath. Accept any line that is a postgres URL
# rather than demanding a hand-written KEY=VALUE file.
$pooledUrl = Get-Content -LiteralPath $ConnectionFile |
  Where-Object { $_ -match '^\s*postgresql://' } |
  Select-Object -First 1

if (-not $pooledUrl) {
  throw "No postgresql:// URL found in $ConnectionFile"
}
$pooledUrl = $pooledUrl.Trim()

# Neon's pooled endpoint is the direct endpoint with '-pooler' inserted into the
# hostname. Deriving the direct URL this way is reliable for Neon specifically,
# and it is verified by an actual connection attempt below rather than trusted.
$directUrl = $pooledUrl -replace '-pooler\.', '.'
if ($directUrl -eq $pooledUrl) {
  throw "Could not derive a direct URL from the pooled URL (expected '-pooler' in the hostname)."
}

function Get-Masked([string]$url) {
  return ($url -replace '://([^:]+):([^@]+)@', '://$1:****@')
}

Write-Host 'Connection strings found:' -ForegroundColor Cyan
Write-Host "  pooled : $(Get-Masked $pooledUrl)"
Write-Host "  direct : $(Get-Masked $directUrl)"

# ---- 2. Verify both endpoints before touching anything ----
# Testing first means a typo in the password is reported now, not after a
# half-applied migration.
$psql = Join-Path $repoRoot 'tools\pgsql\bin\psql.exe'
if (-not (Test-Path $psql)) {
  throw "psql not found at $psql"
}

function Get-ConnParts([string]$url) {
  # The Neon URL carries '&' in its query string, which PowerShell splits into
  # extra arguments when psql is called positionally. Parsing it here and passing
  # host/user/database as separate flags avoids that entirely, and keeps the
  # password out of the argument list via PGPASSWORD.
  $uri = [Uri]$url
  $userInfo = $uri.UserInfo.Split(':', 2)
  # A regex rather than System.Web.HttpUtility, which is not loaded in
  # Windows PowerShell 5.1 without an extra Add-Type.
  $sslMode = 'require'
  if ($uri.Query -match 'sslmode=([^&]+)') { $sslMode = $Matches[1] }
  # A postgres URL without an explicit port leaves [Uri].Port at -1.
  $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
  return @{
    Host     = $uri.Host
    Port     = $port
    User     = [Uri]::UnescapeDataString($userInfo[0])
    Password = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { '' }
    Database = $uri.AbsolutePath.Trim('/')
    SslMode  = $sslMode
  }
}

foreach ($pair in @(@{ Name = 'direct'; Url = $directUrl }, @{ Name = 'pooled'; Url = $pooledUrl })) {
  Write-Host "Testing $($pair.Name) connection..." -ForegroundColor Cyan
  $c = Get-ConnParts $pair.Url
  $env:PGPASSWORD = $c.Password
  $env:PGSSLMODE = $c.SslMode
  $out = & $psql -h $c.Host -p $c.Port -U $c.User -d $c.Database -tA -c 'select 1' 2>&1
  $code = $LASTEXITCODE
  $env:PGPASSWORD = $null
  $env:PGSSLMODE = $null
  if ($code -ne 0) {
    # Echo the output with the password stripped before showing it.
    $safe = ($out | Out-String) -replace '://([^:]+):([^@]+)@', '://$1:****@'
    throw "The $($pair.Name) connection failed:`n$safe"
  }
  Write-Host "  $($pair.Name) OK" -ForegroundColor Green
}

# ---- 3. Generate the credentials once ----
# The static RandomNumberGenerator.GetBytes(int) overload only exists in .NET
# Core. Windows PowerShell 5.1 runs on .NET Framework, where a fresh instance
# with Create().GetBytes() is required.
function New-RandomBytes([int]$count) {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $buffer = New-Object byte[] $count
    $rng.GetBytes($buffer)
    return $buffer
  } finally {
    $rng.Dispose()
  }
}

$pepper = [Convert]::ToBase64String((New-RandomBytes 48))
# Satisfies the app's policy: 12+ chars, upper, lower, digit, symbol.
$adminPassword = 'Adm-' + [Convert]::ToBase64String((New-RandomBytes 18)) + '!7'

if (Test-Path $SecretsFile) {
  throw "$SecretsFile already exists. Delete it first if you really mean to rotate these values."
}

@(
  "# Generated by tools/prepare-neon.ps1 - git-ignored, never commit."
  "# set-fly-secrets.ps1 uploads these to Fly. The pepper MUST be the same one"
  "# used to seed, or the admin password can never be verified."
  "PASSWORD_PEPPER=$pepper"
  "SEED_ADMIN_PASSWORD=$adminPassword"
  "SEED_ADMIN_EMAIL=$AdminEmail"
  "SEED_ADMIN_NAME=Software Owner"
) | Set-Content -LiteralPath $SecretsFile -Encoding UTF8

Write-Host "Credentials written to $SecretsFile" -ForegroundColor Green

# ---- 4. Migrate and seed against the DIRECT url ----
$env:DATABASE_URL = $directUrl
$env:PASSWORD_PEPPER = $pepper
$env:SEED_ADMIN_PASSWORD = $adminPassword
$env:SEED_ADMIN_EMAIL = $AdminEmail
$env:SEED_ADMIN_NAME = 'Software Owner'
# The seed loads .env by default, which would reintroduce the local pepper.
$env:ENV_FILE = 'nonexistent-seed-env'

Push-Location $backend
try {
  Write-Host 'Applying migrations...' -ForegroundColor Cyan
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy failed.' }

  Write-Host 'Seeding roles, plans, settings and the first SUPER_ADMIN...' -ForegroundColor Cyan
  npm run prisma:seed
  if ($LASTEXITCODE -ne 0) { throw 'prisma:seed failed.' }

  # Prove the owner can actually sign in before anything is deployed. A seed
  # that reports success while producing an unusable hash is silent otherwise.
  Write-Host 'Verifying the seeded owner can authenticate...' -ForegroundColor Cyan
  npm run verify:seed-credentials
  if ($LASTEXITCODE -ne 0) {
    throw 'The seeded owner cannot authenticate with these credentials. Not deploying.'
  }
} finally {
  Pop-Location
  # Never leave production credentials in the shell of this session.
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PASSWORD_PEPPER -ErrorAction SilentlyContinue
  Remove-Item Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Database ready. Next: run tools/set-fly-secrets.ps1 to upload these' -ForegroundColor Cyan
Write-Host 'same credentials to Fly and perform the first deploy.' -ForegroundColor Cyan
Write-Host ''
Write-Host "Admin email    : $AdminEmail" -ForegroundColor Green
Write-Host "Admin password : see $SecretsFile (SEED_ADMIN_PASSWORD)" -ForegroundColor Green
