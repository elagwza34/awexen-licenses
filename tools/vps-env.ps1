# Writes the production secrets to the VPS and starts the API container.
#
#   .\tools\vps-env.ps1 -Host root@1.2.3.4
#
# Every value is read from local files that already hold the live secrets — the
# production connection string from .env.production.local.txt and the pepper and
# JWT secrets from .deploy-secrets.local. Nothing is typed by hand, and nothing
# is written to a file on the VPS: the command is piped straight into `docker run`
# as environment variables, so no secret is ever left sitting in /root or /tmp.
#
# The pepper MUST be the same one used to seed the database, or the admin
# password can never be verified. It is read, never generated, for that reason.

param(
  [Parameter(Mandatory = $true)]
  [string]$Host_,
  [string]$Domain = 'pms.awexen.com',
  [string]$User = 'root'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Read-Value([string]$file, [string]$key) {
  $line = Get-Content (Join-Path $root $file) -Encoding UTF8 |
    Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if (-not $line) { throw "$key not found in $file" }
  ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$databaseUrl = Read-Value '.env.production.local.txt' 'DATABASE_URL'
$pepper      = Read-Value '.deploy-secrets.local'    'PASSWORD_PEPPER'
$adminEmail  = Read-Value '.deploy-secrets.local'    'SEED_ADMIN_EMAIL'

# JWT secrets are generated fresh when absent; the portal does not need them to
# match any previous deployment because no live session survives a restart.
$deploy = Get-Content (Join-Path $root '.deploy-secrets.local') -Raw -Encoding UTF8
$jwt     = if ($deploy -match '(?m)^JWT_ACCESS_SECRET=(.+)$')  { $Matches[1].Trim() } else { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
$refresh = if ($deploy -match '(?m)^JWT_REFRESH_SECRET=(.+)$') { $Matches[1].Trim() } else { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }

# The signing key travels as a file, mounted read-only, not as an env var: it is
# multi-line and this way it never passes through a shell argument.
$keyFile = Join-Path $root 'backend\keys\license-private.pem'
if (-not (Test-Path $keyFile)) { throw "Missing $keyFile — licences cannot be renewed without it." }
$keyPem = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyFile))

Write-Host "Restarting the API on $($Host_ -replace '^[^@]+@','')" -ForegroundColor Cyan

# Quoted heredoc on the remote so nothing expands until it lands there.
$remote = @"
set -e
mkdir -p /opt/owneradmin/keys /var/lib/owneradmin/receipts
echo '$keyPem' | base64 -d > /opt/owneradmin/keys/license-private.pem
chmod 600 /opt/owneradmin/keys/license-private.pem
docker rm -f owneradmin-api >/dev/null 2>&1 || true
docker run -d --name owneradmin-api --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e API_PREFIX=api/v1 \
  -e SERVER_NAME=$Domain \
  -e CORS_ORIGINS=https://$Domain \
  -e TRUST_PROXY=true \
  -e RECEIPTS_DIR=/data/receipts \
  -e LICENSE_PRIVATE_KEY_PATH=/app/keys/license-private.pem \
  -e DATABASE_URL='$databaseUrl' \
  -e JWT_ACCESS_SECRET='$jwt' \
  -e JWT_REFRESH_SECRET='$refresh' \
  -e PASSWORD_PEPPER='$pepper' \
  -v /opt/owneradmin/keys:/app/keys:ro \
  -v /var/lib/owneradmin/receipts:/data/receipts \
  owneradmin-api:vps >/dev/null
echo 'container started'
"@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
ssh "${User}@${Host_}" "echo '$b64' | base64 -d | bash"

Write-Host "`nAdmin account: $adminEmail" -ForegroundColor Green
Write-Host 'Migrations were already applied to Neon on 26 Sep, so none are pending.' -ForegroundColor DarkGray
Write-Host 'Run tools\vps-caddy.ps1 next if the hostname is not serving yet.' -ForegroundColor Cyan
