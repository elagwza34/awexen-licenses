<#
.SYNOPSIS
  Generates production secrets and uploads them to a Railway service.

.DESCRIPTION
  The Railway counterpart of tools\set-fly-secrets.ps1, with the same guarantees:

    - secrets are generated in memory and handed straight to the CLI; nothing is
      written to disk by this script, and no secret is ever echoed to the console,
      so a shell history or a screenshot cannot leak them;
    - every secret is passed through STDIN, never through the command line, so it
      cannot be read out of the process table by another local user;
    - the license signing private key is read from disk (it must survive restarts
      and re-deploys) and uploaded as LICENSE_PRIVATE_KEY_PEM_B64. The container
      entrypoint writes it back to a file at start-up.

  Each secret is uploaded in its own `railway variable set KEY --stdin` call
  rather than one call with many KEY=VALUE arguments, because the multi-pair form
  would place every secret in the argument list at once.

.PARAMETER Service
  Railway service name (or id) that receives the variables.

.PARAMETER DatabaseUrl
  Neon connection string. Use the POOLED url (-pooler) for the running app.

.PARAMETER AdminEmail
  Email of the first SUPER_ADMIN created by the seed.

.PARAMETER ServerName
  Public API hostname, e.g. api.awexen.com. env.validation.ts refuses to boot in
  production when this is missing or still the placeholder value.

.PARAMETER FrontendOrigin
  Origin allowed by CORS, e.g. https://pms.awexen.com.

.EXAMPLE
  .\tools\set-railway-variables.ps1 -Service owner-admin-api `
      -DatabaseUrl 'postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require' `
      -AdminEmail 'owner@awexen.com' `
      -ServerName 'api.awexen.com' `
      -FrontendOrigin 'https://pms.awexen.com'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Service,
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [Parameter(Mandatory = $true)][string]$ServerName,
  [Parameter(Mandatory = $true)][string]$FrontendOrigin,
  # $PSScriptRoot is not populated while param defaults are evaluated; these are
  # resolved in the body instead.
  [string]$PrivateKeyPath,
  [string]$SecretsFile,
  # Optional override. Defaults to "railway" resolved from PATH, then npm global.
  [string]$RailwayPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $PrivateKeyPath) { $PrivateKeyPath = Join-Path $repoRoot 'backend\keys\license-private.pem' }
if (-not $SecretsFile) { $SecretsFile = Join-Path $repoRoot '.deploy-secrets.local' }

# The CLI ships either as a standalone binary or as an npm global package, and
# neither is reliably on PATH in a non-interactive PowerShell session. A concrete
# path is resolved here rather than through Set-Alias, because the cmd.exe
# redirection in Set-VariableFromStdin needs a real executable path.
if (-not $RailwayPath) {
  $cmd = Get-Command railway -ErrorAction SilentlyContinue
  if ($cmd) { $RailwayPath = $cmd.Source }
}
if (-not $RailwayPath) {
  $npmGlobal = (& npm root -g 2>$null)
  if ($npmGlobal) {
    $candidate = Join-Path ($npmGlobal.Trim()) '@railway\cli\bin\railway.exe'
    if (Test-Path $candidate) { $RailwayPath = $candidate }
  }
}
if (-not $RailwayPath) {
  throw 'railway CLI not found. Install it with: npm i -g @railway/cli'
}

if (-not (Test-Path $PrivateKeyPath)) {
  throw "Private key not found at $PrivateKeyPath. Run: npm run keygen"
}

# A package listed in BOTH dependencies and devDependencies is a real bug: npm
# treats it as dev-only, so `npm ci --omit=dev` drops it and the container dies at
# boot with "Cannot find module '<pkg>'" long after the build looked fine. This
# exact mistake (@nestjs/swagger) shipped once already.
$pkgPath = Join-Path $repoRoot 'backend\package.json'
if (Test-Path $pkgPath) {
  $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
  $prod = @($pkg.dependencies.PSObject.Properties.Name)
  $dev = @($pkg.devDependencies.PSObject.Properties.Name)
  $dupes = @($prod | Where-Object { $dev -contains $_ })
  if ($dupes.Count) {
    throw ("package.json lists these in BOTH dependencies and devDependencies, so they " +
      "are pruned from the production image and the app crashes on boot: " +
      "$($dupes -join ', '). Remove them from devDependencies.")
  }
}

# The key is transported base64-encoded because a raw PEM is multi-line and a
# variable value cannot contain newlines. The entrypoint decodes and validates it.
$keyPem = [IO.File]::ReadAllText($PrivateKeyPath)
if ($keyPem -notmatch '-----BEGIN [A-Z ]*PRIVATE KEY-----') {
  throw "The file at $PrivateKeyPath is not a PEM private key."
}
$keyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($keyPem))

# The pepper and the bootstrap admin password must be the SAME values the seed
# used; the seed hashes the admin password as `password::pepper`. Uploading a
# different pepper would make the owner account permanently unable to sign in.
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
function Set-VariableFromStdin([string]$Key, [string]$Value) {
  # A temporary file rather than a pipeline, for two reasons:
  #   - PowerShell's pipeline to a native process prepends a UTF-8 BOM, which the
  #     CLI would then read as the first characters of the value;
  #   - PowerShell has no `<` redirection operator, so cmd.exe performs the
  #     redirection, which is also what keeps the value out of the argument list.
  $tmpFile = Join-Path ([IO.Path]::GetTempPath()) ("railway-var-" + [Guid]::NewGuid().ToString('N') + '.txt')
  try {
    [IO.File]::WriteAllBytes($tmpFile, [Text.UTF8Encoding]::new($false).GetBytes($Value))
    & cmd.exe /c "`"$RailwayPath`" variable set $Key --stdin --skip-deploys --service `"$Service`" < `"$tmpFile`""
    if ($LASTEXITCODE -ne 0) { throw "railway variable set $Key failed." }
  } finally {
    # The file holds a production secret in clear text; it must not survive.
    Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Uploading variables to Railway service '$Service'..." -ForegroundColor Cyan

# --skip-deploys on every call: each `variable set` would otherwise restart the
# service, so the app would boot once per variable with an incomplete
# configuration and crash on the missing DATABASE_URL each time. The deploy at
# the end applies them all at once.
Set-VariableFromStdin 'DATABASE_URL'                $DatabaseUrl
Set-VariableFromStdin 'JWT_ACCESS_SECRET'           $jwtSecret
Set-VariableFromStdin 'PASSWORD_PEPPER'             $pepper
Set-VariableFromStdin 'LICENSE_PRIVATE_KEY_PEM_B64' $keyBase64
Set-VariableFromStdin 'SEED_ADMIN_EMAIL'            $AdminEmail
Set-VariableFromStdin 'SEED_ADMIN_PASSWORD'         $adminPassword
Set-VariableFromStdin 'SEED_ADMIN_NAME'             'Software Owner'

# Non-secret but deployment-specific. Safe as plain arguments: nothing in this
# list can sign a token, hash a password or open the database.
#
# TRUST_PROXY is required because Railway's edge proxy terminates TLS and sets
# X-Forwarded-*; without it every request looks like it came from the proxy itself
# and the rate limiter rejects legitimate users.
#
# PORT is deliberately NOT set. Railway injects PORT itself and routes traffic to
# it; overriding it here is the classic cause of a healthy container that answers
# nothing on its public domain.
Write-Host 'Setting non-secret configuration...' -ForegroundColor Cyan
& $RailwayPath variable set --skip-deploys --service $Service `
  'NODE_ENV=production' `
  "SERVER_NAME=$ServerName" `
  "API_PUBLIC_URL=https://$ServerName" `
  "CORS_ORIGINS=$FrontendOrigin" `
  'TRUST_PROXY=true' `
  'API_PREFIX=api/v1' `
  'JWT_ACCESS_TTL=15m' `
  'JWT_REFRESH_TTL_DAYS=30' `
  'LICENSE_PRIVATE_KEY_PATH=keys/license-private.pem' `
  'LICENSE_PUBLIC_KEY_PATH=keys/license-public.pem' `
  'LICENSE_KEY_PREFIX=PROD' `
  'LICENSE_KEY_GROUPS=4' `
  'LICENSE_KEY_GROUP_LEN=4' `
  'DEFAULT_CURRENCY=EGP' `
  'DEFAULT_VALIDATION_INTERVAL_HOURS=72' `
  'DEFAULT_GRACE_PERIOD_DAYS=7' `
  'DEFAULT_TRIAL_DAYS=14' `
  'DEFAULT_MAX_DEVICES=1' `
  'DEFAULT_TIMEZONE=Africa/Cairo'
if ($LASTEXITCODE -ne 0) { throw 'railway variable set failed.' }

Write-Host ''
Write-Host 'Deploying so the new variables take effect and migrations run...' -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
  & $RailwayPath up --service $Service
  if ($LASTEXITCODE -ne 0) { throw 'railway up failed.' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. The first SUPER_ADMIN credentials are in:' -ForegroundColor Green
Write-Host "  $SecretsFile" -ForegroundColor Green
Write-Host ''
Write-Host 'Open that file, store the password in a password manager, then delete' -ForegroundColor Yellow
Write-Host 'the file. It is not saved anywhere else.' -ForegroundColor Yellow
}
$jwtSecret = [Convert]::ToBase64String($jwtBuffer)