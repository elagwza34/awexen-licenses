# Installs Caddy and points it at the API container and the static panel.
#
#   .\tools\vps-caddy.ps1 -Host root@1.2.3.4 -Domain pms.awexen.com
#
# Caddy rather than the nginx from infra/: it issues and renews a Let's Encrypt
# certificate on its own, so there is no certbot cron and nothing to re-run when
# the certificate renews. One process also serves both the panel and the API,
# which keeps the browser on a single origin and means no CORS configuration.
#
# The API is bound to 127.0.0.1:4000 by the container run, so it is unreachable
# from the internet even before this file exists — this only adds TLS, the
# public hostname and the SPA fallback.

param(
  [Parameter(Mandatory = $true)]
  [string]$Host_,
  [string]$Domain = 'pms.awexen.com',
  [string]$User = 'root'
)

$ErrorActionPreference = 'Stop'

$caddyfile = @"
$Domain {
	encode zstd gzip

	# The customer portal and the owner panel both authenticate with a bearer
	# token held in memory, so nothing here should be cached by a shared proxy.
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	# Uploaded receipts can be up to 5 MB; the default 10 MB body cap is fine but
	# the path is explicit so a large receipt is never silently truncated.
	request_body {
		max_size 8MB
	}

	handle /api/* {
		reverse_proxy 127.0.0.1:4000
	}

	# Hashed assets are immutable, so they can be cached hard. index.html must
	# not be, or a returning customer keeps loading the old bundle.
	@immutable path /assets/*
	header @immutable Cache-Control "public, max-age=31536000, immutable"

	handle {
		root * /opt/owneradmin/frontend
		try_files {path} /index.html
		file_server
	}
}
"@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($caddyfile))

Write-Host "Installing Caddy and writing /etc/caddy/Caddyfile" -ForegroundColor Cyan
ssh "${User}@${Host_}" @"
set -e
if ! command -v caddy >/dev/null 2>&1; then
	(apt-get update -qq && apt-get install -qq -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg) >/dev/null
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/debian any main" > /etc/apt/sources.list.d/caddy-stable.list
	apt-get update -qq && apt-get install -qq -y caddy
fi
echo '$b64' | base64 -d > /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy
systemctl enable caddy >/dev/null
echo 'caddy is up'
"@

Write-Host "`nChecking https://$Domain/api/v1/health ..." -ForegroundColor Cyan
Start-Sleep -Seconds 8
try {
  $health = Invoke-RestMethod "https://$Domain/api/v1/health" -TimeoutSec 15
  $health | ConvertTo-Json -Compress | Write-Host
  if ($health.status -eq 'ok') {
    Write-Host "Live: https://$Domain/portal/register" -ForegroundColor Green
  }
}
catch {
  Write-Warning "Health check failed: $($_.Exception.Message)"
  Write-Warning "Check the log: ssh $User@${Host_} 'journalctl -u caddy -n 50'"
}
