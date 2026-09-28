# MIGRATION_ANALYSIS — Node.js/NestJS → PHP/Laravel

Analysis of the existing production backend, written before any rewrite.
Sources: `owner-admin/backend` (NestJS 10 + Prisma 5) and `pms/api`
(the offline/licensed client).

---

## 0. Headline findings (read first)

| # | Finding | Consequence |
|---|---------|-------------|
| 1 | Licence signatures are **PKCS#1 v1.5 over SHA-256**, base64, of a **`JSON.stringify` canonical string** | PHP must reproduce `JSON.stringify` **byte for byte**. See §7. |
| 2 | Production key is **RSA 3072-bit, PKCS#8, e=65537** | Supported natively by PHP. No obstacle. |
| 3 | `JSON.stringify` does **not** escape `/`; PHP `json_encode` **does** by default | **A naive `json_encode()` breaks every existing licence.** `JSON_UNESCAPED_SLASHES` is mandatory. |
| 4 | Passwords are **Argon2id with `${plain}::${pepper}` applied before hashing** | Laravel's default hasher cannot verify these. |
| 5 | Two JWT audiences sign with the same secret: `admin` and `customer-portal` | Both must be reproduced or a portal token passes admin routes. |
| 6 | The API is healthy; the blocker is a **Fly.io billing state**, not a language problem | A rewrite would be a rewrite *under a deployment emergency*. See §13. |

**On point 6, plainly:** this migration is on the table because of a hosting
billing error, not a defect in the Node backend — `/health` returns
`status: ok, database: up, signingKeyLoaded: true`. That is a 5-minute unblock.
Rewriting a working licensing system to escape a hosting account is a large,
avoidable risk. §13 gives the cheaper options and what was already built.


---

## 1. Current architecture

```
Browser (React SPA, Cloudflare Pages → pms.awexen.com)
        │  Bearer JWT; the portal uses no cookies
        ▼
NestJS 10 API (Fly.io, 512 MB / 1 vCPU → api.awexen.com)
        │  Prisma 5
        ▼
PostgreSQL on Neon (eu-central-1, pooled)
```

- **Global prefix** `api/v1` (`API_PREFIX`).
- **Guard order:** `ThrottlerGuard` → `JwtAuthGuard` → `PermissionsGuard`.
- Portal routes carry `@Public()` so the *global* JWT guard stands down, then
  re-check with `CustomerJwtGuard` at the route level. **This ordering is
  load-bearing** — a literal port will 401 every signed-in customer.
- `TRUST_PROXY=true` so `req.ip` is the real client behind Fly's proxy; rate
  limiting depends on it.

**Not in use:** Redis appears in `docker-compose.yml`, but no code imports a
Redis client. It must not be introduced in a rewrite.

---

## 2. Modules and endpoints

18 controllers under the `api/v1` prefix.

### Public
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | 5/min per IP |
| POST | `/auth/refresh` | 30/min, httpOnly cookie |
| POST | `/auth/logout` | |
| GET | `/health` | status, database, `signingKeyLoaded` |
| GET | `/public-key` | **public** key only |
| POST | `/license/activate` | 60/min — offline client |
| POST | `/license/validate` | 60/min — offline client |
| GET | `/licensing/settings` | cached public settings |
| GET | `/releases/latest` | advisory update check |
| GET | `/releases/public-key` | |

### Customer portal (`@Public()` + `CustomerJwtGuard`, audience `customer-portal`)
| Method | Path | Notes |
|---|---|---|
| POST | `/portal/register` | 300/min (was 5 per 10 min) |
| POST | `/portal/login` | 300/min + per-account lockout, 5 fails / 15 min |
| GET | `/portal/me` | |
| GET | `/portal/overview` | keys **masked** (`PROD-2DW********5W3F`) |
| GET | `/portal/licenses` | keys **in full** |
| GET | `/portal/requests` | |
| GET | `/portal/requests/{id}/receipt` | scoped by `customerId`, else 404 |
| GET | `/portal/catalogue` | |
| GET | `/portal/download` | 403 `PAYMENT_PENDING` until paid |
| POST | `/portal/activation-request` | multipart, 5 MB receipt |

### Admin (bearer JWT, audience `admin`)
`/auth/me`, `/admins/*`, `/roles`, `/permissions`, `/customers/*`, `/plans/*`,
`/features/*`, `/subscriptions/*`, `/licenses/*`, `/devices/*`, `/activations`,
`/expirations`, `/support/*`, `/payments/*`, `/releases/*`, `/analytics/*`,
`/audit-logs`, `/settings/*`, `/receipts/{name}`, `/scheduler/*`.

`POST /payments/{id}/approve-activation` confirms the payment, enables the
download and issues a licence. Kept separate from key generation so confirmed
money is not lost if signing fails.


---

## 3. Response envelope

Both success and failure pass through `AllExceptionFilter`:

```json
{ "success": true,  "data": … }
{ "success": false, "error": { "code": "…", "message": "…",
                               "details": …, "requestId": "…" } }
```

Lists are `{ "data": [...], "meta": { page, limit, total, totalPages } }`.
The frontend depends on both shapes; changing either is a breaking change.

---

## 4. Database schema

23 models, snake_case tables via `@@map`, 23 enums. Conventions to preserve:

- Money is **integer minor units** + an ISO currency column.
- All timestamps are `timestamptz` in UTC.
- Historical rows are never deleted (licences, payments, audit logs).
- `audit_logs` has **no `updated_at`** — append-only by design.
- Enums are native Postgres types, so the DB itself rejects invalid states.
- `json` columns: `old_value`, `new_value`, `metadata`, `value` (settings),
  `payload` (notifications).

---

## 5. Authentication

- **Admin:** JWT HS256, audience `admin`, issuer `awexen`, 15 m access. The
  refresh token is an opaque 48-byte value stored **SHA-256 hashed only**, in an
  **httpOnly cookie** scoped to `/api/v1/auth`, with rotation and family-based
  reuse detection.
- **Portal:** JWT HS256, audience `customer-portal`, held in memory on the
  client — a reload signs the customer out, which is deliberate.
- `Permission` / `Role` / `RolePermission` / `AdminRole` drive authorization
  through `PermissionsGuard`.
- TOTP 2FA for admins (RFC 6238, 30 s, 6 digits, ±1 window).

---

## 6. Password hashing

---

## 7. RSA licence system — the critical section

### 7.1 Exact signing contract

Key: **RSA 3072-bit**, PKCS#8 PEM, e=65537, loaded from
`LICENSE_PRIVATE_KEY_PATH`. Confirmed by reading the live key.

Algorithm: **`crypto.sign('sha256', …)` → RSASSA-PKCS1-v1_5**, not PSS.
(ed25519 is handled as a branch but is not in use.)

The signed bytes are the output of `JSON.stringify` over a **fixed key order**
with `features` sorted:

```js
JSON.stringify({
  licenseKey, planKey, edition,
  features: [...features].sort(),   // sorted — order is not significant
  maxDevices, issuedAt, expiresAt, version,
})
```

The signature is **standard base64** (not base64url). `payloadHash` is
`sha256(canonical)` in hex.

**The PHP trap.** `JSON.stringify('a/b')` → `"a/b"`, but
`json_encode('a/b')` → `"a\/b"`. Any string containing a slash produces different
bytes and therefore a **different, invalid signature**. Plan names, editions and
feature keys are all realistic sources of slashes.

The canonicaliser must use:

```php
json_encode($ordered, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
```

**Practical consequence:** the risk is invisible until a payload actually
contains `/`. A test suite using only `PRO` and `inventory` would pass and then
break in production. `backend/tools/verify-signing.js` was added to sign with
Node and cross-verify with PHP; it needs `php` on `PATH` to run. It was run on
this machine and PHP is **not installed**, so the cross-check is still pending.

### 7.2 Licence lifecycle

Create (on paid approval) → activate (key redeemed, device bound) → renew /
re-sign (`resign()` bumps `version`) → expire → suspend → revoke.

- `max_devices` is enforced at activation; exceeding it yields
  `ValidationStatus.DEVICE_LIMIT`.
- Device fingerprints are `sha256(parts.join('|') . '::' . pepper)`, so they
  cannot be forged or reversed.
- The scheduler reconciles status hourly and queues expiry notices daily.

### 7.3 Offline client

`pms/api` verifies licences **locally with the RSA public key** and calls
`/license/activate` and `/license/validate` when online, re-verifying stored
licences offline.

**Therefore:** any licence Laravel issues must verify against the *existing*
public key using the *existing* verification code. This is why the canonical
form must be reproduced exactly — the desktop app cannot be redeployed in step

---

## 8. Scheduled jobs

| Cadence | Purpose | Failure behaviour |
|---|---|---|
| `@Cron(EVERY_HOUR)` | reconcile licence statuses | logged, retried next hour |
| `*/15 * * * *` | refresh cached licensing settings | non-fatal |
| `10 1 * * *` | queue expiry notifications | writes `notifications` rows (outbox) |
| `40 1 * * *` | audit recent status transitions | append-only rows |

Single-leader election via a **Postgres advisory lock**, so replicas are safe.
Converting to `schedule:run` under standard Linux cron is appropriate — none of
these need a resident process.

---

## 9. Environment variables

`NODE_ENV`, `PORT`, `API_PREFIX`, `SERVER_NAME`, `API_PUBLIC_URL`,
`CORS_ORIGINS`, `TRUST_PROXY`, `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `PASSWORD_PEPPER`,
`LICENSE_PRIVATE_KEY_PATH`, `LICENSE_PUBLIC_KEY_PATH`, `LICENSE_KEY_GROUPS`,
`LICENSE_KEY_PREFIX`, `LICENSE_KEY_GROUP_LEN`, `RECEIPTS_DIR`,
`RECEIPTS_URL_PREFIX`, `THROTTLE_*`, `SEED_ADMIN_*`, `DATABASE_POOL_SIZE`.

`env.validation.ts` **refuses to boot** in production without `CORS_ORIGINS`
and a ≥32-character `JWT_ACCESS_SECRET`. That guard must be kept.

---

## 10. Security components to preserve

Argon2id + pepper · RSASSA-PKCS1-v1_5 with the private key server-side only ·
audience-separated JWTs · refresh-token rotation with reuse detection · refresh
tokens stored hashed, never raw · per-account sign-in lockout · the
`@Public()` + dedicated-guard ordering · receipt type detection from magic bytes
rather than the client filename · UUID receipt filenames · `nosniff` and
`private, no-store` on receipts · **404 (not 403)** for another customer's
receipt, so existence is not leaked · identical Argon2 work on unknown emails
to prevent enumeration · a central exception filter that never returns stack
traces.

---

## 11. External integrations

None requiring a provider. `Notification` is an **outbox**; delivery is not
implemented. No payment gateway, no email sender, no Redis. The only network
dependency is client → API.

---

## 12. Migration risks

1. **Signature compatibility (critical).** `JSON.stringify` vs `json_encode`
   escaping. Breaks every licence if wrong.
2. **Argon2 + pepper.** Laravel's hasher cannot verify the existing PHC strings
   without a custom driver; silent failure locks out every user.
3. **Two JWT audiences.** Conflating them turns a portal token into an admin
   token — privilege escalation.
4. **Guard ordering.** `@Public()` is load-bearing; a literal port 401s every
   signed-in customer.
5. **Enums.** 23 Postgres enum types must be reused, not re-created, or existing
   rows stop validating.
6. **`timestamptz` and money-as-int.** Truncating to a float silently changes
   amounts.
7. **The offline client cannot be redeployed in step.** Any payload change breaks
   already-shipped desktop installs.
8. **Single-writer risk.** Node and Laravel must not both own the scheduler.
9. **Scope.** ~23 models, 18 controllers, a signing system, an offline client and
   a payment gate. A multi-week project, not a migration task.

---

## 13. Recommendation

The Node backend is **working and deployed**. The blocker is a Fly.io billing
state:

```
failed to update VM …: We require your billing information
```

That is an account setting, not a code defect — fixed by adding billing details
or by moving the container. Work already prepared for the second option:

- `tools/deploy.ps1` — Fly deploy using `--depot` and `--skip-release-command`,
  the two flags that bypass the trial restrictions.
- `tools/deploy-vps.ps1`, `tools/vps-env.ps1`, `tools/vps-caddy.ps1` — a VPS path
  that keeps **Neon** (so no data moves and no migration is pending), terminates
  TLS with Caddy, and ships the private key by file rather than image layer.

A Laravel rewrite is worth doing if the team wants Laravel on its own merits,
on a timeline, with the Node backend kept and compared against. It should not be
the price of a hosting outage.

**Nothing in the existing backend was modified during this analysis.** The only
addition is the read-only cross-check tool `backend/tools/verify-signing.js`.

with a server rewrite, and already-issued licences must keep working.


```
argon2id, memoryCost = 19456 (19 MiB), timeCost = 2, parallelism = 1
password = plain + "::" + PASSWORD_PEPPER      // peppered BEFORE hashing
```

Existing hashes are PHC strings (`$argon2id$v=19$m=19456,t=2,p=1$…`) and
**must keep verifying**. The pepper is read from the environment, never
generated — a new pepper makes every existing password unverifiable.
