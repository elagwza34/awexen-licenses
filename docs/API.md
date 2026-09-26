# API Reference

Base URL: `/api/v1` · Content type: `application/json` · Auth: `Bearer <access token>`

Interactive docs: `http://localhost:4000/api/docs` (development only).

## Conventions

**List envelope** — every list endpoint returns:

```json
{ "data": [ … ], "meta": { "total": 0, "page": 1, "limit": 25, "totalPages": 1, "hasNext": false, "hasPrev": false } }
```

**Error envelope** — every failure returns:

```json
{
  "success": false,
  "error": { "code": "LICENSE_NOT_FOUND", "message": "License not found", "details": null, "requestId": "…" }
}
```

| Status | When |
| --- | --- |
| 400 | Validation failed, or the request contradicts a business rule |
| 401 | Missing/expired access token, or bad credentials |
| 403 | Authenticated but lacking the required permission |
| 404 | Entity not found |
| 409 | Conflict (duplicate key, illegal lifecycle transition) |
| 422 | Unprocessable payload |
| 429 | Rate limited |
| 500 | Internal error (details are never leaked) |

**Common query parameters:** `page`, `limit` (max 100), `search`, `sortBy`,
`sortOrder=asc|desc`.

**Money** is always an integer of minor units (`49900` = 499.00) plus an ISO
currency. The frontend divides by 100 for display only.

---

## Auth — `/api/v1/auth`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/login` | public | 5/min. Body: `email`, `password`, optional `totpCode` |
| POST | `/refresh` | cookie | Rotates the refresh token, returns a new access token |
| POST | `/logout` | bearer | Revokes the current session |
| POST | `/logout-all` | bearer | Revokes every session for the admin |
| GET | `/me` | bearer | Profile, roles and resolved permissions |
| POST | `/change-password` | bearer | Revokes all other sessions on success |
| POST | `/forgot-password` | public | Always returns the same generic message |
| POST | `/reset-password` | public | Body: `token`, `newPassword` |
| GET | `/sessions` | bearer | Active sessions |
| GET | `/login-history` | `admins.view` | Recent sign-in attempts |
| POST | `/2fa/enable` | bearer | Body: `code` — verified before persisting |
| POST | `/2fa/disable` | bearer | Body: `code` |
| GET | `/permissions` | bearer | Permission keys granted to the caller |

The refresh token is delivered as an `httpOnly`, `SameSite=Strict`,
path-scoped (`/api/v1/auth`) cookie. `Secure` is enabled in production.


## Customers — `/api/v1/customers`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `customers.view` — `status`, `search`, pagination |
| GET | `/stats` | `customers.view` |
| GET | `/:id` | `customers.view` — profile + subscriptions, licences, payments, invoices, tickets, activations, audit |
| POST | `/` | `customers.create` |
| PUT | `/:id` | `customers.update` |
| DELETE | `/:id` | `customers.delete` — **suspends instead of deleting** when history exists |

## Plans — `/api/v1/plans`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `plans.view` — with resolved `featureKeys` |
| GET | `/distribution` | `plans.view` — subscribers and MRR per plan |
| GET | `/:id` | `plans.view` |
| POST | `/` | `plans.create` — body includes `featureIds` |
| PUT | `/:id` | `plans.update` — `featureIds` replaces the entitlement set |
| DELETE | `/:id` | `plans.delete` — **archives instead of deleting** when in use |

A plan's `key` cannot change while licences reference it, because the customer
application matches on it.

## Features — `/api/v1/features`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `features.view` |
| POST | `/` | `features.create` |
| PUT | `/:id` | `features.update` — key is locked while licences depend on it |
| DELETE | `/:id` | `features.delete` — **deprecates instead of deleting** when plans grant it |

## Licenses — `/api/v1/licenses`

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/` | `licenses.view` | `status`, `customerId`, `planId`, `expiresAfter/Before` |
| GET | `/expiring?filter=` | `licenses.view` | `today` \| `7d` \| `30d` \| `expired` \| `grace` |
| GET | `/by-key/:key` | `licenses.view` | Case- and separator-insensitive lookup |
| GET | `/:id` | `licenses.view` | Devices, features, `derivedStatus`, `deviceSlotsFree` |
| GET | `/:id/payload` | `licenses.view` | Signed payload + public key |
| GET | `/:id/history` | `licenses.view` | Activations, validations, audit rows |
| POST | `/` | `licenses.create` | Expiry defaults to the plan billing interval |
| PUT | `/:id` | `licenses.update` | Bumps `version`; rejects plan changes (use `change-plan`) |
| POST | `/:id/renew` | `licenses.update` | Atomic: licence + subscription + siblings + audit |
| POST | `/:id/extend` | `licenses.update` | Body: `days`, `reason` |
| POST | `/:id/suspend` | `licenses.suspend` | Reversible; history preserved |
| POST | `/:id/reactivate` | `licenses.activate` | **409 if REVOKED** |
| POST | `/:id/revoke` | `licenses.revoke` | Terminal; also revokes devices and cancels the subscription |
| POST | `/:id/change-plan` | `licenses.update` | Refuses downgrades below active device count |
| POST | `/:id/reset-device` | `devices.reset` | Revokes the device, logs a `DEVICE_RESET` activation |

Lifecycle responses include `derivedStatus` (server truth) alongside the stored
`status` (a cache).

## License validation (public) — `/api/v1/validations`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/validate` | public | 60/min per IP. Always 200 with a `status` field |
| GET | `/history` | bearer | Owner-panel validation history |

`POST /validate` is the only endpoint the customer application needs. It
records every attempt — success or failure — in `license_validations`, enforces
the device limit server-side, refreshes the signature on each call, and caps
`validUntil` at the licence expiry.

## Analytics — `/api/v1/analytics`

All require `analytics.view`. Every number is a real aggregate.

| Path | Returns |
| --- | --- |
| `/overview` | Customers, licence buckets, devices, today's revenue, MRR/ARR |
| `/timeseries?months=` | Monthly revenue, customers, subscriptions, activations, expirations |
| `/churn?months=` | Monthly churned count, base and rate |
| `/plan-distribution` | Subscribers and licences per plan |
| `/license-health` | Licences grouped by status |
| `/validation-health?days=` | Validation outcomes and failure rate |
| `/recent-activity?limit=` | Latest activations, payments and licences |
| `/mrr` | MRR and ARR |

**MRR** sums only recurring subscriptions: monthly as-is, quarterly ÷ 3,
yearly ÷ 12, lifetime excluded.

## Audit — `/api/v1/audit-logs`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `audit.view` — `entity`, `entityId`, `action`, `adminId`, `search` |
| GET | `/actions` | `audit.view` — distinct actions with counts |
| GET | `/entity/:entity/:id` | `audit.view` — full history for one record |

Append-only. There is no write, update or delete endpoint, and the model has no
`updatedAt` by design. Secrets (`passwordHash`, tokens, TOTP ciphertext,
signatures) are redacted before writing.

## Settings — `/api/v1/settings`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` \| `/:key` | `settings.view` |
| PUT | `/:key` | `settings.update` — sensitive keys need an explicit confirm flag |
| PUT | `/` | `settings.update` — bulk update |

Values are coerced and validated against the declared type. Saving pushes
licence rules into the live services immediately. Sensitive values are never
returned in full.

## System

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Database reachability, signing key loaded, uptime |
| GET | `/public-key` | public | License verification public key (PEM) |

---

## Roadmap

Phase 1 — done: auth + RBAC, customers, plans, features, licences, devices,
activations, validations, analytics, audit query, settings API, dashboard UI.

Phase 2 — backend endpoints, UI still to build: subscriptions CRUD and
lifecycle, payments (verify/refund/manual), support tickets, app versions and
releases, admins module, notification delivery, scheduled expiry job
(`@Cron` over `reconcileAllLicenses`), automated test suite.

