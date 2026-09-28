# Architecture analysis

## Current system

| Layer | Technology |
|---|---|
| Runtime | Node.js (Fly.io, 512 MB / 1 vCPU) |
| Framework | NestJS 10 |
| ORM | Prisma 5 |
| Database | PostgreSQL on **Neon** (serverless) |
| Cache / queue | **none** — no Redis client in `package.json` |
| Auth | `@nestjs/jwt` HS256, two audiences |
| Hashing | `argon2` (native) |
| Scheduling | `@nestjs/schedule` |
| Frontend | React SPA, served separately by Nginx |

`package.json` dependencies confirm no Redis, no Bull, no cache manager. The
only outbound network dependency is browser → API.

## Modules (18 controllers)

| Module | Route prefix | Public routes |
|---|---|---|
| `auth` | `/auth` | 4 |
| `analytics` | `/analytics` | 0 |
| `audit` | `/audit-logs` | 0 |
| `customers` | `/customers` | 0 |
| `devices` | `/devices` | 0 |
| `features` | `/features` | 0 |
| `licenses` | `/licenses` | 0 |
| `license-validation` | `/validations` | 1 (`POST /validate`) |
| `scheduler` | `/scheduler` | 0 |
| `payments` | `/payments` | 0 |
| `receipts` | `/receipts` | 0 |
| `plans` | `/plans` | 0 |
| `releases` | `/releases` | 1 (`GET /latest`) |
| `settings` | `/settings` | 0 |
| `subscriptions` | `/subscriptions` | 0 |
| `support` | `/support` | 0 |
| `customer-portal` | `/portal` | 12 |
| `health` | *(none)* | 2 (`/health`, `/public-key`) |

Global prefix `api/v1` → `/api/v1/auth/login`, `/api/v1/portal/...`, etc.

## Request pipeline

```
helmet → cookieParser → CORS → global prefix
  → ValidationPipe (whitelist + forbid)
  → ThrottlerGuard        (per-route limits)
  → JwtAuthGuard          (audience-pinned, @Public() honoured)
  → PermissionsGuard      (AND semantics, SUPER_ADMIN bypass)
  → Controller
  → AllExceptionsFilter   (one response shape, never leaks internals)
```

`receipts.controller.ts` mounts `JwtAuthGuard` explicitly, since it also needs
the audience pin on a raw file-streaming response.

## Response envelope

Success and failure are both wrapped by the exception filter:

```json
{ "success": true,  "data": … }
{ "success": false, "error": { "code", "message", "details", "requestId" } }
```

Paginated lists return `{ "data": [...], "meta": { page, limit, total, totalPages } }`
via the shared `paginated()` helper.

The React frontend depends on both shapes. Changing either is a breaking change.

## Timestamps and money

- `timestamptz` in UTC throughout; the API serialises ISO-8601 with
  milliseconds and a `Z` suffix (`toISOString()`).
- Money is **integer minor units** + an ISO currency column. Never a float.

## Environments

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | gates Swagger + dev keygen |
| `PORT` | `4000` | |
| `API_PREFIX` | `api/v1` | |
| `DATABASE_URL` | — | **required** |
| `JWT_ACCESS_SECRET` | — | **required, ≥32 chars** |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_REFRESH_TTL_DAYS` | `30` | 1–365 |
| `PASSWORD_PEPPER` | `''` | **≥16 in production** |
| `LICENSE_PRIVATE_KEY_PATH` | `keys/license-private.pem` | |
| `LICENSE_PUBLIC_KEY_PATH` | `keys/license-public.pem` | |
| `LICENSE_KEY_PREFIX` | `PROD` | |
| `CORS_ORIGINS` | `http://localhost:5173` | must change in prod |
| `SERVER_NAME` | `admin.example.com` | must change in prod |
| `TRUST_PROXY` | `false` | enables `trust proxy = 1` |

Note there is **no** `JWT_REFRESH_SECRET` — one secret signs both audiences and
all tokens. The brief's `.env.example` sketch lists `JWT_SECRET` and
`JWT_ISSUER`; the real names are `JWT_ACCESS_SECRET` and a hardcoded issuer
`awexen`.

## Third-party services

**None.** No payment gateway, no email sender, no error tracker, no Redis.
`Notification` is an outbox table; delivery is not implemented. Payments are
recorded manually by an admin.

## What this means for the Laravel port

The target architecture is simpler than a default Laravel install:

- **No queue** — `schedule:run` is sufficient; the brief's "queue only where
  required" resolves to *not required*.
- **No Redis** — cache via the database or `array` driver.
- **No Sanctum/Passport** — the API contract is JWT with two audiences.
- **No permission package** — four tables and a Gate suffice.
- **Sessions** — the API is stateless; the only cookie is the refresh token.
- `storage/` is needed only for logs and the `bootstrap/cache` config.

## Deployment target

VPS + Nginx/Caddy + PHP-FPM + Neon, with `schedule:run` on a standard cron. This
avoids the permanently-running Node process the current design implies, and
works well with `php artisan` tooling.
