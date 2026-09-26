# Owner Admin Panel

The commercial control centre for a licensed inventory / POS product.

This is **System 2** — the software owner's own panel for selling and enforcing
licenses. It is completely separate from **System 1**, the customer-facing
inventory application, and it never stores customer business data.

```
Customer → Plan → Subscription → License → Activation → Device
   → Validation → Renewal → Expiration / Suspension / Revocation
```

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind, shadcn-style Radix primitives, TanStack Query, React Hook Form + Zod |
| Backend | NestJS 10, TypeScript, REST |
| Database | PostgreSQL 16, Prisma 5 |
| Auth | JWT access tokens + rotating opaque refresh tokens, Argon2id, RBAC, optional TOTP 2FA |
| Infrastructure | Docker, Nginx, Linux VPS |

## Layout

```
owner-admin/
  backend/
    prisma/schema.prisma     20 models, all enums, constraints and indexes
    prisma/seed.ts           permissions, roles, features, plans, settings, owner
    scripts/                 signing key generation
    src/
      auth/  customers/  plans/  licenses/  analytics/  audit/  settings/
      common/  prisma · audit · crypto · guards · filters
  frontend/
    src/
      components/  layouts/  pages/  hooks/  lib/  types/
  infra/nginx/              reverse proxy + TLS
  database/                 init scripts
  docs/
    ARCHITECTURE.md         how the pieces fit, and why
    BUSINESS_RULES.md       the 13 rules and where each is enforced
    SETUP.md                local and production setup
    API.md                  endpoint reference
```

## Quick start

```bash
cp .env.example .env          # then edit: DATABASE_URL, secrets, seed admin
docker compose up -d          # Postgres + Redis

cd backend
npm install
npx prisma migrate dev --name init
npm run keygen                # creates the license signing key pair
npm run prisma:seed           # roles, permissions, features, plans, settings, owner
npm run start:dev             # http://localhost:4000/api/v1

cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

Full detail, including the production checklist, is in
[`docs/SETUP.md`](docs/SETUP.md).

## Security posture

- The **license signing private key never leaves the server** — not in the
  frontend, not in git, not in a Docker layer, not in any API response.
  The customer application only ever receives a signed payload plus the
  public key.
- Passwords are Argon2id hashed with a server-side pepper.
- The access token lives in memory (not `localStorage`); the refresh token is
  an httpOnly cookie stored server-side as a SHA-256 hash, rotated on every
  use, with reuse detection that revokes the whole token family.
- Every non-public route is authenticated by default and authorised by a
  permission guard. Hiding a button in the UI is never the enforcement.
- All 13 business rules are enforced server-side and written to an append-only
  audit log inside the same transaction as the change.
- Licences are never hard-deleted; customers and plans are soft-deleted or
  archived so history survives.
- Business rules that would otherwise be magic numbers (validation interval,
  grace period, trial length, currency) are stored in `settings` and editable
  from the panel.

See [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md).

## The customer application contract

The desktop application calls one endpoint to stay licensed:

```http
POST /api/v1/validations/validate
Content-Type: application/json

{
  "licenseKey": "PROD-7F3A-92KD-0XLM-QP4E",
  "deviceFingerprint": "<stable machine hash>",
  "deviceName": "Reception PC",
  "platform": "WINDOWS",
  "appVersion": "1.2.0"
}
```

It always receives HTTP 200 with a definitive answer:

```json
{
  "valid": true,
  "status": "SUCCESS",
  "message": "License is valid",
  "validUntil": "2026-09-28T12:00:00.000Z",
  "payload": {
    "licenseKey": "PROD-7F3A-92KD-0XLM-QP4E",
    "planKey": "PROFESSIONAL",
    "edition": "Professional",
    "features": ["INVENTORY", "POS", "PRODUCTS", "SALES"],
    "maxDevices": 3,
    "issuedAt": "2026-01-01T00:00:00.000Z",
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "version": 4
  },
  "signature": "base64…",
  "publicKey": "-----BEGIN PUBLIC KEY-----…",
  "serverTime": "2026-09-25T12:00:00.000Z",
  "release": {
    "latestVersion": "1.3.0",
    "minSupportedVersion": "1.0.0",
    "updateRequired": false,
    "downloadUrl": "https://…"
  }
}
```

Failure statuses: `EXPIRED`, `SUSPENDED`, `REVOKED`, `INVALID`, `DEVICE_LIMIT`,
`FAILED`. A failure carries no payload, so a blocked client learns nothing about
its entitlements.

The client verifies `signature` against the embedded **public** key. When
`validUntil` passes it must call again — that is the configurable validation
interval (72 h by default), bounded by the licence expiry.

## Verified status

Everything below has been executed, not merely written:

| Check | Result |
| --- | --- |
| `prisma validate` | Schema valid — 20 models, 30 enums |
| `prisma generate` | Client generated |
| `tsc --noEmit` (backend) | 0 errors |
| `tsc --noEmit` (frontend) | 0 errors |
| `nest build` | Success |
| `vite build` | 2549 modules, 5.8s |
| `npm run verify` | **34/34** crypto checks pass |
| `npm run verify:business` | **28/28** status-rule checks pass |
| API boot | DI graph resolves, 65 routes mapped |
| `GET /api/v1/health` | 200, reports DB state honestly |
| `GET /api/v1/public-key` | 200, serves the real public key |
| `GET /api/v1/customers` (no token) | **401** — guard enforced |

Three bugs that the TypeScript compiler could never have caught were found and
fixed by running this suite:

1. **`argon2.verify` arguments were swapped** — every sign-in would have failed
   silently, because the thrown error was swallowed by a `catch`.
2. **Three NestJS dependency-injection failures** — the app could not boot at
   all. `AuditService` and `AuthService` injected the raw `PrismaClient` token
   instead of the `PrismaService` provider; `SecurityService` was not exported
   from `CryptoModule`; `SettingsModule` did not import `LicensesModule`.
3. **A Prisma relation was missing its opposite field** — the schema would not
   even validate.

Not yet exercised, because no PostgreSQL server is available in this
environment: the seed against a live database, migrations, and any endpoint
that reads or writes rows.

## Current status

Phase 1 is complete: infrastructure, full database schema, authentication with
RBAC, the dashboard, customers, plans and licences — all on real API data with
explicit loading, empty and error states.

Phase 2 modules (subscriptions, devices, activations, payments, features,
support, releases, analytics screens, audit log screen, settings screen) have
working **backend** endpoints where implemented and honest placeholder routes
in the UI. No screen displays fabricated data. See the roadmap in
[`docs/API.md`](docs/API.md).
