# Going live: Fly.io + Neon + Cloudflare Pages

Production topology:

| Piece | Where | Hostname |
|-------|-------|----------|
| React panel | Cloudflare Pages | `pms.awexen.com` |
| NestJS API | Fly.io, region `fra` | `api.awexen.com` |
| PostgreSQL | Neon (pooled connection) | — |

The API must not stop: the scheduler (hourly status reconciliation, expiry
notices, audit of transitions) runs inside the same process. `fly.toml`
therefore sets `auto_stop_machines = "off"` and `min_machines_running = 1`.

---

## 0. Prerequisites

```powershell
winget install --id Fly-io.flyctl -e
flyctl auth login          # opens a browser
flyctl auth whoami         # must print your account
```

> **Never run `flyctl launch` inside `backend/`.** That wizard would overwrite
> `fly.toml` and try to attach a Fly Postgres. Create the app explicitly:
> ```powershell
> cd backend
> flyctl apps create owneradmin-api --org personal
> ```
>
> There is no `--region` flag on `apps create`. The region comes from
> `primary_region = "fra"` in `fly.toml` and is applied on the first
> `flyctl deploy`.

---

## 1. Neon

Dashboard → **New Project** → name `owneradmin`.

Copy **both** connection strings from the connection panel:

- **Pooled** (`...-pooler...`) — used by the running app (`DATABASE_URL`).
- **Direct** (`ep-xxx...`) — used for migrations and the seed from your machine.

Keep the direct one out of the app; the pooled one must never be used for
`prisma migrate`.

Apply the schema and create the first admin once, from `backend/`:

```powershell
$env:DATABASE_URL = 'postgresql://...DIRECT...'
npx prisma migrate deploy
npm run prisma:seed        # needs SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
```

---

## 2. Secrets and first deploy

From the repository root:

```powershell
.\tools\set-fly-secrets.ps1 `
  -App owneradmin-api `
  -DatabaseUrl 'postgresql://...POOLED...' `
  -AdminEmail 'owner@awexen.com'
```

The script generates the JWT secret and password pepper in memory, uploads
them together with the RSA private key, deploys, and prints the generated
SUPER_ADMIN password **once**. Store it in a password manager immediately.

The private key is uploaded as `LICENSE_PRIVATE_KEY_PEM`; the container
entrypoint (`backend/docker-entrypoint.sh`) writes it to
`/app/keys/license-private.pem` at start-up. It is never in the image and
never in git. `backend/.dockerignore` blocks `keys/` and `*.pem` from the
build context so it cannot be captured by a layer even by accident.

Verify:

```powershell
(Invoke-RestMethod https://owneradmin-api.fly.dev/api/v1/health) | ConvertTo-Json
# status: ok, database: up, signingKeyLoaded: true
```

---

## 3. Attach `api.awexen.com`

```powershell
flyctl certs create api.awexen.com --app owneradmin-api
flyctl ips list --app owneradmin-api
```

In Cloudflare DNS add an **A** record `api` → the Fly IPv4, proxied (orange
cloud), plus the **AAAA** record for the IPv6. TLS terminates at Fly's edge.

Test: `https://api.awexen.com/api/v1/health`.

---

## 4. Cloudflare Pages

Dashboard → **Create** → **Pages** → **Connect to Git**, or upload the
`frontend/dist` folder directly if you would rather not expose a repository.

| Setting | Value |
|---------|-------|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `24` |

Environment variable (build-time — it is compiled into the bundle):

```
VITE_API_BASE_URL=https://api.awexen.com/api/v1
```

`frontend/public/_redirects` provides the SPA fallback, `_headers` the security
headers and asset caching.

Attach the custom domain `pms.awexen.com` in the Pages project.

---

## 5. Cut over

Only after both `https://api.awexen.com/api/v1/health` and
`https://pms.awexen.com` respond correctly:

1. Remove the old Windrose demo from the host.
2. Log in at `https://pms.awexen.com` and change the admin password.
3. Embed the public key in the desktop app — fetch it once:
   ```powershell
   (Invoke-RestMethod https://api.awexen.com/api/v1/public-key).publicKey
   ```

---

## Notes and gotchas

- **Migrations run in the release command**, not on start, so two machines can
  never apply the same migration concurrently.
- **The scheduler needs the machine awake.** If you later enable
  `auto_stop_machines`, the maintenance jobs stop running too.
- **Losing the private key means existing licences can no longer be renewed.**
  Back up `backend/keys/license-private.pem` somewhere the app server cannot
  read, and never in the repository.
- **The update check is advisory.** It never decides whether the product runs;
  licence validation does. Keep the two endpoints separate.
- **Secrets are never in git:** no `.env`, no database URL, no JWT secret, no
  pepper, no `*.pem`. Run a scan before the first push:
  ```powershell
  git ls-files | Select-String -Pattern '\.env$|\.pem$|keys/'
  ```
  It must print nothing.
