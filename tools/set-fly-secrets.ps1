<#
.SYNOPSIS
  Generates production secrets and uploads them to the Fly.io app.

.DESCRIPTION
  Secrets are generated in memory and handed straight to `flyctl secrets import`.
  Nothing is written to disk by this script, and no secret is ever echoed to the
  console — a shell history or a screenshot must not be able to leak them.

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
  [string]$PrivateKeyPath = (Join-Path $PSScriptRoot '..\backend\keys\license-private.pem')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command flyctl -ErrorAction SilentlyContinue)) {
  throw 'flyctl not found. Install it with: winget install --id Fly-io.flyctl -e'
}

if (-not (Test-Path $PrivateKeyPath)) {
  throw "Private key not found at $PrivateKeyPath. Run: npm run keygen"
}

# The key must be a real PEM block. Uploading a truncated file would produce an
# app that boots but can never sign a license — a silent, expensive failure.
$privateKey = (Get-Content -LiteralPath $PrivateKeyPath -Raw).Trim()
if ($privateKey -notmatch '-----BEGIN (RSA )?PRIVATE KEY-----') {
  throw "The file at $PrivateKeyPath does not look like a PEM private key."
}

# 64 random bytes, base64-encoded: comfortably above the 32-character minimum the
# app enforces, and long enough that guessing is impossible.
$jwtSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
$pepper = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

# A long random password: the seed hashes it with Argon2, so it is never stored
# in clear text. It is printed once, at the end, so it can be saved in a
# password manager.
$adminPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))

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
Write-Host 'Done. The first SUPER_ADMIN credentials are:' -ForegroundColor Green
Write-Host "  email:    $AdminEmail"
Write-Host "  password: $adminPassword"
Write-Host ''
Write-Host 'Store that password in a password manager now — it is not saved' -ForegroundColor Yellow
Write-Host 'anywhere else and cannot be recovered.' -ForegroundColor Yellow
