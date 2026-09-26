<#
.SYNOPSIS
  Generates production secrets and uploads them to the Fly.io app.

.DESCRIPTION
  Secrets are generated in memory and handed straight to `flyctl secrets import`.
  Nothing is written to disk by this script, and no secret is ever echoed to the
  console - a shell history or a screenshot must not be able to leak them.

  The license signing private key is read from disk (it must survive restarts
  and re-deploys) and uploaded as the LICENSE_PRIVATE_KEY_PEM secret. The
  container entrypoint writes it back to a file at start-up.

.PARAMETER App
  Fly app name. Must already exist.

.PARAMETER DatabaseUrl
  Neon connection string. Use the POOLED url (-pooler) for the running app.

.PARAMETER AdminEmail
  Email of the first SUPER_ADMIN created by the seed.

.EXAMPLE
  .\tools\set-fly-secrets.ps1 -App owneradmin-api `
      -DatabaseUrl 'postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require' `
      -AdminEmail 'owner@awexen.com'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  # $PSScriptRoot is not populated while param defaults are evaluated; these are
  # resolved in the body instead.
  [string]$PrivateKeyPath,
  [string]$SecretsFile
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $PrivateKeyPath) { $PrivateKeyPath = Join-Path $repoRoot 'backend\keys\license-private.pem' }
if (-not $SecretsFile) { $SecretsFile = Join-Path $repoRoot '.deploy-secrets.local' }

if (-not (Get-Command flyctl -ErrorAction SilentlyContinue)) {
  throw 'flyctl not found. Install it with: winget install --id Fly-io.flyctl -e'
}

if (-not (Test-Path $PrivateKeyPath)) {
  throw "Private key not found at $PrivateKeyPath. Run: npm run keygen"
}

# The key must be a real PEM block. Uploading a truncated file would produce an
# app that boots but can never sign a license - a silent, expensive failure.
$privateKey = (Get-Content -LiteralPath $PrivateKeyPath -Raw).Trim()
if ($privateKey -notmatch '-----BEGIN (RSA )?PRIVATE KEY-----') {
  throw "The file at $PrivateKeyPath does not look like a PEM private key."
}

# The pepper and the admin password are REUSED from prepare-neon.ps1, never
# regenerated here. The database already stores a hash of the admin password
# produced with that pepper; uploading a different one would make the owner
# account permanently unable to sign in.
if (-not (Test-Path $SecretsFile)) {
  throw "Secrets file not found: $SecretsFile. Run tools\prepare-neon.ps1 first."
}
$stored = @{}
Get-Content -LiteralPath $SecretsFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $stored[$matches[1]] = $matches[2] }
}

$pepper = $stored['PASSWORD_PEPPER']
$adminPassword = $stored['SEED_ADMIN_PASSWORD']
if (-not $pepper -or -not $adminPassword) {
  throw "PASSWORD_PEPPER or SEED_ADMIN_PASSWORD missing from $SecretsFile."
}

# The JWT secret is not used to hash anything already stored, so a fresh one is
# correct here. (Static GetBytes is .NET Core only; see prepare-neon.ps1.)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $jwtBuffer = New-Object byte[] 64
  $rng.GetBytes($jwtBuffer)
} finally {
  $rng.Dispose()
}
$jwtSecret = [Convert]::ToBase64String($jwtBuffer)

Write-Host "Uploading secrets to Fly app '$App'..." -ForegroundColor Cyan

# `secrets import` reads NAME=VALUE pairs from stdin, which keeps every value
# out of the process argument list where another local user could read it from
# the process table. (Note: `secrets set` in this flyctl version has no
# --stdin flag, so import is the correct command here.)
$secrets = @(
  "DATABASE_URL=$DatabaseUrl"
  "JWT_ACCESS_SECRET=$jwtSecret"
  "PASSWORD_PEPPER=$pepper"
  "SEED_ADMIN_EMAIL=$AdminEmail"
  "SEED_ADMIN_PASSWORD=$adminPassword"
  "SEED_ADMIN_NAME=Software Owner"
  "LICENSE_PRIVATE_KEY_PEM=$privateKey"
) -join "`n"

$secrets | flyctl secrets import --app $App
if ($LASTEXITCODE -ne 0) { throw 'flyctl secrets import failed.' }

# Setting a secret restarts the app, but the release command only runs on
# `flyctl deploy`. Re-deploying now guarantees the machine comes up against the
# new DATABASE_URL with migrations already applied.
Write-Host 'Deploying so the new secrets take effect and migrations run...' -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
  flyctl deploy --app $App
  if ($LASTEXITCODE -ne 0) { throw 'flyctl deploy failed.' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. The first SUPER_ADMIN credentials are in:' -ForegroundColor Green
Write-Host "  $SecretsFile" -ForegroundColor Green
Write-Host ''
Write-Host 'Open that file, store the password in a password manager, then delete' -ForegroundColor Yellow
Write-Host 'the file. It is not saved anywhere else.' -ForegroundColor Yellow
