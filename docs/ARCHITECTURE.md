# Owner Admin Panel — Architecture

## The two-system rule

This repository contains **only** the owner/admin control panel. It never holds
customer business data (products, stock, invoices).

```
┌──────────────────────────┐        ┌────────────────────────────────────┐
│ SYSTEM 2 — Owner Panel   │        │ SYSTEM 1 — Customer App            │
│ (this repo)              │        │ (separate project)                 │
│ React SPA → NestJS API   │        │ Inventory / POS / WooCommerce     │
└────────────┬─────────────┘        └───────────────┬────────────────────┘
             │                                       │
             │  issues licenses, validates keys      │ POST /api/v1/validations/validate
             ▼                                       ▼
      ┌──────────────────────────────────────────────────────┐
      │            License Server (this API)                  │
      │  PostgreSQL · signing key · audit log · RBAC          │
      └──────────────────────────────────────────────────────┘
```

The customer application never touches the database. It calls
`POST /api/v1/validations/validate` and receives a **signed** payload.

## Lifecycle

```
Customer → Plan → Subscription → License → Activation → Device
   → Validation → Renewal → Expiration / Suspension / Revocation
```

Each arrow is enforced server-side and written to `audit_logs` inside the same
transaction as the state change.

## Request pipeline

```
Request
  → requestIdMiddleware       attach X-Request-Id for traceability
  → helmet                   security headers
  → CORS (credentials: true) required for the refresh cookie
  → ThrottlerGuard           global rate limit (per-route overrides)
  → JwtAuthGuard             verifies the access token
  → PermissionsGuard         @RequirePermissions(...) — server-side RBAC
  → ValidationPipe           strips unknown fields (anti mass-assignment)
  → Controller / Service
  → Prisma transaction       business write + audit row, atomically
  → AllExceptionsFilter      one error shape, no internals leaked
```

### Why guards are global

Every route is authenticated by default. A controller must opt out with
`@Public()`. A forgotten guard on a new endpoint fails closed instead of
silently exposing data.


## Security model

| Concern | Implementation |
| --- | --- |
| Password storage | Argon2id + a server-side pepper; never logged |
| Access tokens | JWT, 15 min, held in memory in the SPA (not localStorage) |
| Refresh tokens | Opaque random value in an **httpOnly** cookie; only a SHA-256 hash is stored |
| Token theft | Rotation + reuse detection: replaying a rotated token revokes the whole family |
| Brute force | 5 failed attempts → 15-minute lock; every attempt is logged |
| Authorization | Dotted permission keys per route; `SUPER_ADMIN` bypasses by design but is still audited |
| 2FA | TOTP (RFC 6238), secret AES-256-GCM encrypted at rest |
| Input safety | `whitelist` + `forbidNonWhitelisted` on the global ValidationPipe |
| Headers | Helmet, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY` |
| Signing key | Server-side only, loaded from a file at boot, never returned by any endpoint |
| Multi-instance | One Postgres advisory lock elects the scheduler leader, so N replicas never run the maintenance jobs N times |

## Scaling and the maintenance jobs

The API is stateless and safe to run as N replicas. The scheduled maintenance
jobs are not — two instances reconciling licences at the same time would produce
duplicate notifications and an inconsistent audit trail.

That is handled by a **Postgres advisory lock**. Every instance calls
`pg_try_advisory_lock` at boot (`SchedulerLockService`); only the winner logs
"Scheduler lock acquired" and runs the cron jobs. Losers keep serving traffic but
skip every tick. The lock is session-scoped, so it is released automatically if
the leader's connection dies, and a standby can take over on its next start.

The jobs are also individually idempotent, but idempotence is a backstop rather
than a substitute for the lock: it does not stop two writers from interleaving
mid-run.

### Inspecting and triggering

```bash
# Is this instance the leader?          (requires admins.view)
GET /api/v1/scheduler/status

# Run a job now instead of waiting for the next tick   (requires admins.update)
POST /api/v1/scheduler/run
{ "job": "reconcile-licenses" }

# accepted jobs: reconcile-licenses, refresh-settings,
#                queue-expiry-notifications, audit-transitions
```

`POST /scheduler/run` returns **503** when another instance holds the lock,
because a non-leader cannot know whether the leader is running that job at the
same moment.

This is what removes the need for a separate external cron: the same code path
can be driven from Task Scheduler, a system cron, or a health check without
duplicating any logic.

## License status is server-side truth

`LicenseStatusService` is the **only** place allowed to decide a status.
`derive()` is pure and is reused by the validation endpoint, the scheduler and
the UI, so the three can never disagree.

```
SUSPENDED / REVOKED   → explicit admin decision, never overridden
expiresAt < now       → EXPIRING while inside the grace period, then EXPIRED
expiresAt within N    → EXPIRING (warning window)
isTrial               → TRIAL
otherwise             → ACTIVE
```

Both `grace_period_days` and `expiring_window_days` live in the `settings`
table and are editable from the panel — no magic numbers in code.

## Cryptography

- License payloads are canonicalised (fixed key order, sorted features) so the
  signature is reproducible on the client.
- Signed with RSA-3072 (or Ed25519) via Node's `crypto`.
- The **public** key is safe to embed in the customer application.
- The **private** key is loaded once at boot and never leaves the process.
- Every material change (renew, plan change, suspend…) bumps `licenses.version`
  and re-signs, so a client holding a cached payload detects the change.
- A signing failure raises an error instead of leaving an unsigned licence
  active — the system fails closed.


## Data integrity rules baked into the schema

| Rule | Enforcement |
| --- | --- |
| Licence keys are never reused | `licenses.license_key` is `UNIQUE`; revoked keys are never deleted |
| One device slot per machine | `@@unique([licenseId, deviceFingerprint])` |
| Entitlements are data, not code | `plan_features` join table; nothing hardcodes plan features |
| History is preserved | Customers and plans are soft-deleted / archived, never hard-deleted |
| Payments are append-only | Refunds set `refundedAmount`; the original row is kept |
| Financial precision | All money is an integer of minor units + ISO currency |
| No floating money | Amounts are `Int`; the UI divides by 100 only for display |

## Renewal consistency

Renewal is the operation most likely to corrupt data, so it runs in one
transaction that touches every related record:

1. Anchor = `max(today, current expiry)` so early renewal never shortens a
   paid period.
2. New expiry = anchor + N billing intervals (QUARTERLY = 3 calendar months,
   not 90 days).
3. Update the licence: `expiresAt`, `status`, `version += 1`.
4. Update the bound subscription to the same expiry, and convert
   TRIAL/PastDUE/EXPIRED → ACTIVE.
5. Update every sibling licence on that subscription to the same expiry.
6. Write the audit row in the same transaction.
7. Re-sign every affected licence after commit.

## Backend layout

```
src/
  auth/          login, refresh rotation, password, 2FA, sessions
  admins/        (Phase 2) admin CRUD and role assignment
  customers/     customer CRUD + 360° detail
  plans/         plans and dynamic feature entitlements
  licenses/      issuance, renewal, lifecycle, signing, public validation
  analytics/     overview, timeseries, churn, MRR/ARR
  audit/         append-only audit query API
  settings/      runtime-tunable business rules
  common/
    prisma/      PrismaService
    audit/       AuditService (redacts secrets, runs in-transaction)
    crypto/      Argon2, peppering, TOTP, RSA signing, AES-GCM
    guards/      JwtAuthGuard, PermissionsGuard
    filters/     centralised exception handling
```

## Frontend layout

```
src/
  components/ui/  shadcn-style primitives (Radix + CVA)
  components/     DataTable, StatCard, status badges, state displays
  layouts/        AdminLayout, Sidebar, Topbar
  pages/          one file per screen
  hooks/          useAuth, useConfirm, useToast
  lib/            api client, formatting, navigation model
  types/          shared enums and interfaces
```

- **RTL-first**: `dir="rtl"` on `<html>`, logical Tailwind properties
  (`ps-*`, `me-*`, `start-*`, `text-start`) throughout.
- **Latin identifiers stay LTR**: the `.ltr` utility keeps licence keys and
  plan keys readable inside Arabic text.
- **No fabricated data**: every screen has explicit loading, empty and error
  states, and Phase 2 routes render an honest "not built yet" panel rather
  than fake rows.


