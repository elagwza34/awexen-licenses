# Setup Guide

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or Docker)
- OpenSSL (for key generation)

## 2. Environment

```bash
cd owner-admin
cp .env.example .env
```

Fill in at minimum:

```env
NODE_ENV=development
PORT=4000
API_PREFIX=api/v1
DATABASE_URL=postgresql://owneradmin:YOUR_PASSWORD@localhost:5432/owneradmin?schema=public
JWT_ACCESS_SECRET=<openssl rand -base64 48>
PASSWORD_PEPPER=<openssl rand -base64 32>
SEED_ADMIN_EMAIL=you@company.com
SEED_ADMIN_PASSWORD=<a strong password, 12+ chars, mixed case + digit + symbol>
```

The app **refuses to boot** if `JWT_ACCESS_SECRET` is shorter than 32
characters, and in production it also requires a real `PASSWORD_PEPPER` and a
non-localhost `CORS_ORIGINS`. This is intentional — a misconfigured deployment
fails loudly rather than silently weakening security.

## 3. Database

```bash
cd backend
npm install
npx prisma migrate dev --name init   # creates the schema + first migration
```

Production uses `npx prisma migrate deploy` (no prompts, no drift).

## 4. License signing key

```bash
cd backend
npm run keygen
```

This writes:
- `keys/license-private.pem` — **server only**, mode 600, never committed
- `keys/license-public.pem` — safe to embed in the customer application

In development, if the key is missing the API generates a throwaway one and
logs a warning. In production a missing key is a **hard startup failure**.

The key directory is git-ignored. In Docker the private key is mounted
read-only from the host, never baked into the image.

## 5. Seed data

```bash
npm run prisma:seed
```

Idempotent — safe to re-run. Creates:
- 43 permissions and 5 roles (SUPER_ADMIN, ADMIN, SUPPORT_AGENT, FINANCE, VIEWER)
- 11 features (PRODUCTS, INVENTORY, WOOCOMMERCE, …)
- 3 plans (BASIC, PROFESSIONAL, BUSINESS) with entitlements
- 15 runtime settings
- Your SUPER_ADMIN account

Plan prices are seeded as **0 on purpose**. Set real prices from the Plans
screen before selling — seeding invented prices would be fabricating data.

## 6. Run the API

```bash
npm run start:dev
```

- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/api/docs (development only)
- Health: http://localhost:4000/api/v1/health

## 7. Run the frontend

```bash
cd ../frontend
npm install
npm run dev
```

- Panel: http://localhost:5173

Vite proxies `/api` to the backend, so the browser stays same-origin and the
refresh cookie works without CORS exceptions.

## 8. First sign-in

1. Open http://localhost:5173
2. Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
3. **Change the password immediately** (Account → the panel does not enforce
   this yet, so do it now)
4. Set company details and default currency in Settings
5. Set real prices on each plan
6. Add your first customer, then issue a licence

## 9. Docker

```bash
# Infrastructure only
docker compose up -d

# Full stack including the API and panel
docker compose --profile app up -d --build
```

The backend container runs `prisma migrate deploy` on start.

## 10. Production checklist

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` points at the managed database over TLS
- [ ] `JWT_ACCESS_SECRET` is 48+ random bytes, unique per environment
- [ ] `PASSWORD_PEPPER` is 32+ random bytes, stored in a secrets manager
- [ ] `CORS_ORIGINS` lists only your real panel domain
- [ ] Private key backed up **off the server** and never in git
- [ ] TLS terminated at Nginx with HSTS enabled
- [ ] `SEED_ADMIN_PASSWORD` rotated after the first sign-in
- [ ] `settings.security.require_two_factor` enabled once 2FA is adopted
- [ ] Database backups verified with a restore test
- [ ] Log aggregation shipping `audit_logs` somewhere append-only

## Verification

The system ships with executable checks for the parts where a silent bug would
be expensive — the licensing cryptography and the status rules.

```bash
cd backend
npm run verify           # 34 checks: signing, AES-GCM, TOTP, Argon2, hashing
npm run verify:business  # 28 checks: licence status matrix and boundaries
npm run verify:all       # both
```

`npm run verify` covers:

- RSA sign/verify round-trip, determinism, feature-order independence
- Tamper detection, and rejection of a signature forged with another key
- That only the public key is ever exposed
- AES-256-GCM round-trip, non-determinism, and auth-tag rejection on tampering
- TOTP against the **RFC 6238 published test vectors**
- Argon2id verify success/failure and that the hash never contains the plaintext
- Password policy, fingerprint determinism, token hashing

`npm run verify:business` pins the whole status matrix (the grace-period
boundary at exactly 7 vs 8 days, the `EXPIRING` warning window, lifetime
licences, admin-forced states) against a fixed clock, and proves the grace
period and warning window really are configurable rather than hardcoded.

Both scripts exit non-zero on failure, so they belong in CI.

## Running locally on Windows without Docker or PostgreSQL installed

If you have neither Docker nor a PostgreSQL install, a portable PostgreSQL 16
server is included under `tools/`. It is a real PostgreSQL build, so Prisma
migrations and the seed behave exactly as they would in production.

**First time only** — start the database (it must be running before the API):

```powershell
# One-time: initialise the data cluster
.\tools\pgsql\bin\initdb.exe -D .\tools\pgdata -U postgres -A trust -E UTF8 --locale=C

# Start it (leave the window open, or run it detached)
.\tools\pgsql\bin\pg_ctl.exe -D .\tools\pgdata -l .\tools\pg.log -o "-p 5432 -h 127.0.0.1" start

# Create the database once
.\tools\pgsql\bin\psql.exe -h 127.0.0.1 -p 5432 -U postgres -c "CREATE DATABASE owneradmin;"
```

`.env` is already pointed at this instance:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/owneradmin?schema=public
```

**Then the normal workflow:**

```powershell
cd backend
npx prisma migrate dev --name init
npm run keygen          # only once; refuses to overwrite an existing key
npm run prisma:seed
npm run start:dev       # http://localhost:4000/api/v1

cd ../frontend
npm run dev             # http://localhost:5173
```

**Stop the database when finished:**

```powershell
.\tools\pgsql\bin\pg_ctl.exe -D .\tools\pgdata stop
```

The binaries, the data cluster and all logs are git-ignored — none of it can be
committed by accident.

## Troubleshooting

**`Invalid environment configuration`** — read the listed keys; each line names
exactly what is wrong.

**`License private key not found`** — run `npm run keygen`, or set
`LICENSE_PRIVATE_KEY_PATH` to the real path.

**`P1001: Can't reach database server`** — the database is not running or
`DATABASE_URL` is wrong. `docker compose up -d postgres` to start it locally.

**Signed out immediately** — the refresh cookie is not being stored. Check that
the frontend is served over HTTP in development (`secure: false`) and that you
are not calling the API from a different origin than the page.
