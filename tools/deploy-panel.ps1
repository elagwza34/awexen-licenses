# Builds the owner-admin panel for production and deploys it to Cloudflare Pages.
#
# The Vite build refuses to run without VITE_API_BASE_URL, and the value is not
# committed because it names a real host. Keeping the default here means a
# deploy is one command that cannot produce a bundle pointed at the wrong API.
param(
  [string]$ApiBaseUrl = 'https://api.awexen.com/api/v1',
  [string]$Project = 'owner-admin',
  [string]$Branch = 'main',
  # Set to $false to build without uploading.
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
$Root = Join-Path $PSScriptRoot '..'
$Frontend = Join-Path $Root 'frontend'

if (-not $SkipDeploy) {
  if (-not $env:CLOUDFLARE_API_TOKEN) {
    throw 'CLOUDFLARE_API_TOKEN is not set. It is needed only for the deploy.'
  }
  if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
    throw 'CLOUDFLARE_ACCOUNT_ID is not set. It is needed only for the deploy.'
  }
}

Push-Location $Frontend
try {
  $env:VITE_API_BASE_URL = $ApiBaseUrl
  Write-Host "Building with $ApiBaseUrl" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
} finally {
  Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}

$dist = Join-Path $Frontend 'dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'The build produced no index.html.' }

if ($SkipDeploy) {
  Write-Host "`nBuilt to $dist (not deployed)." -ForegroundColor Green
  return
}

$wrangler = Join-Path $Frontend 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path $wrangler)) {
  throw 'wrangler is not installed. Run: npm install -D wrangler (in frontend).'
}

Write-Host 'Uploading to Cloudflare Pages...' -ForegroundColor Cyan
& $wrangler pages deploy $dist --project-name $Project --branch $Branch --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw 'The Pages upload failed.' }

Write-Host "`nDeployed to https://$Project.pages.dev" -ForegroundColor Green
