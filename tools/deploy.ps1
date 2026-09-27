# Deploy the owner-admin API and panel.
#
# Two separate targets, because they are two separate services:
#   api  -> Fly.io   (owneradmin-api)   serves api.awexen.com
#   web  -> Cloudflare Pages            serves pms.awexen.com
#
# Run from the repository root:
#   .\tools\deploy.ps1
#   .\tools\deploy.ps1 -Target api
#   .\tools\deploy.ps1 -Target web
#
# Notes that will save time if this ever fails again:
#
#  * `--depot` is required. The default path spins up a dedicated Fly *builder
#    machine*, and on a trial account that is rejected with "We require your
#    billing information". The regular build machine is not subject to that.
#
#  * `--skip-release-command` skips `npx prisma migrate deploy`. It is only safe
#    while prisma/migrations/ is unchanged between the running image and this
#    checkout; verify with:
#       git diff --name-only HEAD~1 -- prisma/
#    If that lists anything, drop the flag and let the release command run.

param(
  [ValidateSet('api', 'web', 'all')]
  [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiOrigin = 'https://api.awexen.com/api/v1'

function Deploy-Api {
  Write-Host "`n=== Deploying the API to Fly.io ===" -ForegroundColor Cyan
  Push-Location (Join-Path $root 'backend')
  try {
    flyctl deploy --app owneradmin-api --depot --now --skip-release-command
    if ($LASTEXITCODE -ne 0) { throw 'flyctl deploy failed.' }
  }
  finally {
    Pop-Location
  }

  # The health endpoint proves the new machine is serving, not merely started.
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 5
    try {
      $health = Invoke-RestMethod "$apiOrigin/health" -TimeoutSec 10
      if ($health.status -eq 'ok') {
        Write-Host "API healthy (database: $($health.database))" -ForegroundColor Green
        return
      }
    }
    catch {
      Write-Host 'waiting for the new machine to pass health checks...'
    }
  } while ((Get-Date) -lt $deadline)

  throw 'The API did not report healthy within 60s. Check: flyctl logs --app owneradmin-api'
}

function Deploy-Web {
  Write-Host "`n=== Building the panel ===" -ForegroundColor Cyan
  Push-Location (Join-Path $root 'frontend')
  try {
    # Compiled into the bundle, so it must be set before `vite build` runs.
    $env:VITE_API_BASE_URL = $apiOrigin
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed.' }
  }
  finally {
    Pop-Location
  }

  Write-Host "dist is ready at: $root\frontend\dist" -ForegroundColor Green
  Write-Host 'Upload it with `npx wrangler pages deploy dist --project-name <name>`,' -ForegroundColor Yellow
  Write-Host 'or drag the folder onto https://dash.cloudflare.com > Workers & Pages.' -ForegroundColor Yellow
}

if ($Target -in @('api', 'all')) { Deploy-Api }
if ($Target -in @('web', 'all')) { Deploy-Web }

Write-Host "`nDone." -ForegroundColor Green
