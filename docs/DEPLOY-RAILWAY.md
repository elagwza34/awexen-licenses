# Going live: Railway + Neon + Cloudflare Pages

Production topology:

| Piece | Where | Hostname |
|-------|-------|----------|
| React panel | Cloudflare Pages | `pms.awexen.com` |
| NestJS API | Railway (Dockerfile build) | `api.awexen.com` |
| PostgreSQL | Neon (pooled connection) | — |

The API must not stop: the scheduler (hourly status reconciliation, expiry
notices, audit of transitions) runs inside the same process. `backend/railway.toml`
therefore sets `numReplicas = 1` and leaves `sleepApplication` off.

`backend/railway.toml` is the single source of truth for the build, the migration
step, the health check and the restart policy. Nothing in this document needs to be
re-entered in the dashboard as long as the config path is correct.

---

## 0. Before anything else: rotate the exposed credentials

The Cloudflare API token and the Neon database password were exposed in an earlier
session. **Rotate both before the first deploy** — a deployment is the moment those
credentials start being used in anger.

1. Cloudflare → My Profile → API Tokens → Revoke the old token, create a new one
   scoped only to the zones it must edit.
2. Neon → the project → reset the database password.
3. Update `.env.production.local.txt` (git-ignored) with the new pooled URL.
4. If the schema must be re-applied, re-run `tools\prepare-neon.ps1`; the pepper and
   admin password it generates must stay the ones already uploaded.

## 1. Prerequisites

```powershell
npm i -g @railway/cli
railway login          # opens a browser
railway whoami         # must print your account
```

The repository has **no git remote yet**, so `railway up` (which deploys the local
directory) works immediately, but GitHub autodeploys cannot. See step 6.

---

## 2. Create the project and service

```powershell
cd owner-admin
railway init          # creates the project; answer the prompts
railway add           # adds a service; choose "Empty service" or Dockerfile
```

Then, in the dashboard for the new service → **Settings**:

| Setting | Value |
|---------|-------|
| Root Directory | `backend` |
| Config as Code path | `/backend/railway.toml` |
| Config file used | `railway.toml` |

> Railway does **not** apply the Root Directory to the config file itself: the path
> must be given as the absolute `/backend/railway.toml`, otherwise the file is
> ignored and every setting falls back to the dashboard defaults.

`railway.toml` already pins the builder to `DOCKERFILE` with
`dockerfilePath = "Dockerfile"`, which resolves to `backend/Dockerfile` — the
Dockerfile that installs, builds, prunes dev dependencies and regenerates the
Prisma client in the final tree. The build context is `backend/`, and
`backend/.dockerignore` keeps `keys/`, `*.pem` and every `.env` out of it.

---

## 3. Neon

Copy the **pooled** connection string (`...-pooler...`) from the Neon connection
panel. It is the one uploaded as `DATABASE_URL`; the pooled endpoint must never be
used for `prisma migrate`.

Apply the schema and create the first admin once, from `backend/` and against the
**direct** URL:
---

## 4. Secrets and first deploy

From the repository root:

```powershell
.\tools\set-railway-variables.ps1 `
  -Service owner-admin-api `
  -DatabaseUrl 'postgresql://...POOLED...' `
  -AdminEmail 'owner@awexen.com' `
  -ServerName 'api.awexen.com' `
  -FrontendOrigin 'https://pms.awexen.com'
```

The script generates the JWT secret in memory and uploads every secret through
`railway variable set KEY --stdin`, so no value ever appears in the process table,
in a shell history, or on the console. The RSA private key is uploaded as
`LICENSE_PRIVATE_KEY_PEM_B64`; `backend/docker-entrypoint.sh` decodes it, validates
it with `openssl pkey`, and writes it to `/app/keys/license-private.pem` at
start-up. It is never in the image and never in git.

Every call passes `--skip-deploys`, so the service does not restart once per
variable and boot against a half-configured environment. The final `railway up`
applies them all at once and runs `prisma migrate deploy` as the pre-deploy
command.

Verify:

```powershell
(Invoke-RestMethod https://api.awexen.com/api/v1/health) | ConvertTo-Json
# status: ok, database: up, signingKeyLoaded: true
```

Store the SUPER_ADMIN password from `.deploy-secrets.local` in a password manager,
then delete the file. It is not saved anywhere else.

---

## 5. Attach `api.awexen.com`

Dashboard → the service → **Settings → Networking → Custom Domains** →
`api.awexen.com`. Railway provisions the certificate automatically; there is no
certificate command to run and no IP to copy.

In Cloudflare DNS, point `api` at the Railway domain as a **CNAME**, proxied
(orange cloud). Do not create an A record with a Railway IP — the edge is what
terminates TLS here.

Test: `https://api.awexen.com/api/v1/health`.

---

## 6. Enable GitHub autodeploys

`railway up` deploys from this machine, so the service is already live. To get
automatic deploys on push, the repository needs a remote:

```powershell
cd owner-admin
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin master
```

Then dashboard → the service → **Settings → GitHub Repo** → select the repository.
Set the branch to `master`; the repo's only branch is `master`, not `main`.

Railway only pulls files from the Root Directory (`backend`), so the frontend is
not rebuilt by this service.

---

## 7. Cloudflare Pages

Dashboard → **Create** → **Pages** → **Connect to Git**, or upload the
`frontend/dist` folder directly.

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

Attach the custom domain `pms.awexen.com` in the Pages project.

---

## 8. Cut over

Only after both `https://api.awexen.com/api/v1/health` and
`https://pms.awexen.com` respond correctly:

1. Log in at `https://pms.awexen.com` and change the admin password.
2. Embed the public key in the desktop app — fetch it once:
   ```powershell
   (Invoke-RestMethod https://api.awexen.com/api/v1/public-key).publicKey
   ```
3. Smoke-test the licence flow end to end: issue a key in the panel, register a
   customer through `POST /api/v1/portal/register`, activate one device, then
   confirm the activation count and the expiry notice behave.

---

## Notes and gotchas

- **Receipts need a volume, or they vanish on every deploy.**
  `ReceiptStorageService` writes to `RECEIPTS_DIR`, which defaults to
  `storage/receipts` inside the container filesystem — ephemeral on Railway.
  Attach a Railway volume mounted at `/app/storage` and set
  `RECEIPTS_DIR=/app/storage/receipts`. Two caveats: the image runs as the
  non-root `app` user, so Railway's own docs require `RAILWAY_RUN_UID=0` to write
  into an attached volume; and a service with a volume cannot have replicas, which
  is fine here because the scheduler requires exactly one anyway. Without a volume,
  customer bank-transfer receipts are lost on each redeploy — acceptable only if
  payment proof is handled outside the app.
- **Migrations run in the pre-deploy command**, not on start, so two replicas can
  never apply the same migration concurrently. A failing migration fails the
  deployment instead of shipping a half-migrated app.
- **`PORT` is not set.** Railway injects it and routes traffic to it. Overriding it
  produces a healthy container that answers nothing on its public domain.
- **The scheduler needs the service awake.** If `sleepApplication` is ever enabled,
  the maintenance jobs stop running.
- **Losing the private key means existing licences can no longer be renewed.**
  Back up `backend\keys\license-private.pem` somewhere the app server cannot read,
  and never in the repository.
- **The update check is advisory.** It never decides whether the product runs;
  licence validation does. Keep the two endpoints separate.
- **Secrets are never in git:** no `.env`, no database URL, no JWT secret, no
  pepper, no `*.pem`. Run a scan before the first push:
  ```powershell
  git ls-files | Select-String -Pattern '\.env$|\.pem$|keys/|\.deploy-secrets'
  ```
  It must print nothing.

```powershell
$env:DATABASE_URL = 'postgresql://...DIRECT...'
npx prisma migrate deploy
npm run prisma:seed        # needs SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
```

`tools\prepare-neon.ps1` does all of this and additionally generates the pepper and
the bootstrap admin password into `.deploy-secrets.local` (git-ignored). Those exact
values are what `tools\set-railway-variables.ps1` uploads — the pepper must match,
or the seeded admin password can never verify.