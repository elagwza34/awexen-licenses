# Deploy the owner-admin API and panel to a single VPS.
#
#   .\tools\deploy-vps.ps1 -Host root@1.2.3.4
#
# Why this exists: Fly.io refuses to build or update a machine while the account
# has no billing information set, and a self-hosted VPS sidesteps that entirely.
# The database stays where it is — production is Neon, and only the app moves —
# so there is nothing to migrate and no downtime beyond the restart.
#
# What goes on the server:
#   - the API as a container behind Caddy, which terminates TLS for free
#   - the built panel served as static files by the same Caddy
#
# Not needed on the server: PostgreSQL (it is Neon) and Redis (nothing in the
# codebase imports a Redis client — the compose file declares one, but the app
# does not use it).
#
# Requirements: a 64-bit Linux VPS with Docker, 512 MB free RAM for the API
# (matching the old Fly machine), and ports 80/443 open. 1 vCPU is enough: the
# Argon2id hashing is the heaviest thing here and it is idle except at sign-in.

param(
  [Parameter(Mandatory = $true)]
  [string]$Host_,
  [string]$Domain = 'pms.awexen.com',
  [string]$User = 'root'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Target: $User@$($Host_ -replace '^[^@]+@','')  domain: $Domain" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Build the image locally and ship it, so the server needs no build tooling
#    and no registry account. `docker buildx build --output` writes a tar.
# ---------------------------------------------------------------------------
Write-Host "`n=== Building the API image ===" -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend')
try {
  $image = 'owneradmin-api:vps'
  docker build -t $image .
  if ($LASTEXITCODE -ne 0) { throw 'docker build failed.' }
  docker save $image -o (Join-Path $root 'tools\owneradmin-api.tar')
}
finally { Pop-Location }

Write-Host "`n=== Building the panel ===" -ForegroundColor Cyan
Push-Location (Join-Path $root 'frontend')
try {
  # Relative on purpose: Caddy serves both from one origin, so the browser sees
  # same-origin requests and no CORS entry is required.
  $env:VITE_API_BASE_URL = '/api/v1'
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'frontend build failed.' }
}
finally { Pop-Location }

# ---------------------------------------------------------------------------
# 2. Copy the artefacts up.
# ---------------------------------------------------------------------------
Write-Host "`n=== Copying to the server ===" -ForegroundColor Cyan
$tar = Join-Path $root 'tools\owneradmin-api.tar'
scp $tar "${User}@${Host_}:/root/owneradmin-api.tar"
ssh "${User}@${Host_}" 'mkdir -p /opt/owneradmin/frontend /opt/owneradmin/keys'

# The private signing key is copied directly, never through the image, and never
# through git. Losing it means existing licences can no longer be renewed.
$keyFile = Join-Path $root 'backend\keys\license-private.pem'
if (Test-Path $keyFile) {
  scp $keyFile "${User}@${Host_}:/opt/owneradmin/keys/license-private.pem"
  ssh "${User}@${Host_}" 'chmod 600 /opt/owneradmin/keys/license-private.pem'
}
else {
  Write-Warning "No signing key at $keyFile — licences will not validate without it."
}

scp (Join-Path $root 'frontend\dist\*') "${User}@${Host_}:/opt/owneradmin/frontend/"

# ---------------------------------------------------------------------------
# 3. Run it.
# ---------------------------------------------------------------------------
Write-Host "`n=== Starting the stack ===" -ForegroundColor Cyan
ssh "${User}@${Host_}" 'docker load -i /root/owneradmin-api.tar && rm -f /root/owneradmin-api.tar'

# The env file is written on the server from the values below, which come from
# the same set that set-fly-secrets.ps1 uploads. The pepper MUST match the one
# used to seed, or the admin password can never be verified.
$envScript = @"
set -e
cd /opt/owneradmin
docker rm -f owneradmin-api 2>/dev/null || true
docker run -d --name owneradmin-api --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e API_PREFIX=api/v1 \
  -e SERVER_NAME=$Domain \
  -e CORS_ORIGINS=https://$Domain \
  -e TRUST_PROXY=true \
  -e RECEIPTS_DIR=/data/receipts \
  -e DATABASE_URL='__DATABASE_URL__' \
  -e JWT_ACCESS_SECRET='__JWT__' \
  -e JWT_REFRESH_SECRET='__REFRESH__' \
  -e PASSWORD_PEPPER='__PEPPER__' \
  -e LICENSE_PRIVATE_KEY_PEM='__PRIVATE_KEY__' \
  -v /opt/owneradmin/keys:/app/keys:ro \
  -v /var/lib/owneradmin/receipts:/data/receipts \
  owneradmin-api:vps
"@

Write-Host 'Next: run tools/vps-env.ps1 to write the secrets, then tools/vps-caddy.ps1.' -ForegroundColor Yellow
Write-Host 'Both are generated from your .env and .deploy-secrets.local so nothing is typed by hand.' -ForegroundColor Yellow
