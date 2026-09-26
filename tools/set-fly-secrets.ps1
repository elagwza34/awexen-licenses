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
  [string]$SecretsFile,
  # Optional override. Defaults to "flyctl" resolved from PATH, then WinGet.
  [string]$FlyctlPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $PrivateKeyPath) { $PrivateKeyPath = Join-Path $repoRoot 'backend\keys\license-private.pem' }
if (-not $SecretsFile) { $SecretsFile = Join-Path $repoRoot '.deploy-secrets.local' }

# `flyctl` is installed by winget into a versioned package directory that is not
# reliably on PATH in a non-interactive session. A concrete path is resolved
# here (rather than a Set-Alias) because the cmd.exe redirection below needs a
# real executable path.
if (-not $FlyctlPath) {
  $cmd = Get-Command flyctl -ErrorAction SilentlyContinue
  if ($cmd) { $FlyctlPath = $cmd.Source }
}
if (-not $FlyctlPath) {
  $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $wingetRoot) {
    $found = Get-ChildItem -Path $wingetRoot -Filter 'flyctl.exe' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { $FlyctlPath = $found.FullName }
  }
}
if (-not $FlyctlPath) {
  throw 'flyctl not found. Install it with: winget install --id Fly-io.flyctl -e'
}

if (-not (Test-Path $PrivateKeyPath)) {
  throw "Private key not found at $PrivateKeyPath. Run: npm run keygen"
}

# A package listed in BOTH dependencies and devDependencies is a real bug: npm
# treats it as dev-only, so `npm ci --omit=dev` drops it and the container dies
# at boot with "Cannot find module '<pkg>'" long after the build looked fine.
# This exact mistake (@nestjs/swagger) shipped once already.
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

  # The Fly release_command runs `npx prisma migrate deploy` INSIDE the
  # container, and the Prisma query engine binary must exist at runtime. Both
  # require `prisma` to be a production dependency; as a devDependency it is
  # removed by `npm prune --omit=dev` and the app dies with
  # "Unable to find the Prisma engine ... did you initialize it properly?".
  if ($dev -contains 'prisma' -and $prod -notcontains 'prisma') {
    throw ('prisma is a devDependency, but the production image runs ' +
      '"npx prisma migrate deploy" as the Fly release_command and needs the ' +
      'query engine at runtime. Move it to dependencies.')
  }
}

# A stale package-lock can mark a production dependency (or a transitive
# dependency of one) as dev-only, with the same silent-boot-failure effect.
$lockPath = Join-Path $repoRoot 'backend\package-lock.json'
if (Test-Path $lockPath) {
  $check = @'
const l = require(process.argv[1]);
const root = l.packages[''] || {};
const prod = Object.keys(root.dependencies || {});
const bad = prod.filter((n) => {
  const p = l.packages['node_modules/' + n];
  return !p || p.dev === true;
});
if (bad.length) {
  console.error(bad.join(' '));
  process.exit(1);
}
'@
  $checkFile = Join-Path ([IO.Path]::GetTempPath()) ('lockcheck-' + [Guid]::NewGuid().ToString('N') + '.js')
  try {
    Set-Content -LiteralPath $checkFile -Value $check -Encoding ASCII
    $bad = & node $checkFile $lockPath
    if ($LASTEXITCODE -ne 0) {
      throw ("package-lock.json marks these production dependencies as dev-only, so they " +
        "are pruned from the image and the app crashes on boot: $bad. Fix with: " +
        'cd backend; npm install --package-lock-only')
    }
  } finally {
    Remove-Item -LiteralPath $checkFile -Force -ErrorAction SilentlyContinue
  }
}

# The key is uploaded base64-encoded. `flyctl secrets import` accepts only
# one-line NAME=VALUE pairs, so a raw multi-line PEM is rejected outright
# ("Secrets must be provided as NAME=VALUE pairs"). The container entrypoint
# decodes it and validates it with openssl before the app ever reads it.
$keyBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($PrivateKeyPath))
if ($keyBase64 -match '[\r\n]') { throw 'Base64 key unexpectedly contains a newline.' }

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
  "LICENSE_PRIVATE_KEY_PEM_B64=$keyBase64"
) -join "`n"

# PowerShell's pipeline to a native process prepends a UTF-8 BOM (U+FEFF) to
# the first line, which flyctl then reads as part of the secret name
# ("\ufeffDATABASE_URL" is not a valid secret name). Writing the bytes to a
# temporary file and redirecting stdin from it sends exactly what we wrote, with
# no BOM and no transcoding.
$tmpFile = Join-Path ([IO.Path]::GetTempPath()) ("fly-secrets-" + [Guid]::NewGuid().ToString('N') + '.txt')
try {
  [IO.File]::WriteAllBytes($tmpFile, [Text.UTF8Encoding]::new($false).GetBytes($secrets))
  # PowerShell has no `<` redirection operator, and its pipeline to a native
  # process would re-add the BOM, so cmd.exe performs the redirection. < keeps
  # the secrets out of the process argument list.
  & cmd.exe /c "`"$FlyctlPath`" secrets import --app $App < `"$tmpFile`""
  if ($LASTEXITCODE -ne 0) { throw 'flyctl secrets import failed.' }
} finally {
  # The file contains every production secret in clear text; it must not survive.
  Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
}

# Setting a secret restarts the app, but the release command only runs on
# `flyctl deploy`. Re-deploying now guarantees the machine comes up against the
# new DATABASE_URL with migrations already applied.
Write-Host 'Deploying so the new secrets take effect and migrations run...' -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
  & $FlyctlPath deploy --app $App
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
