# Authentication analysis

Every statement here is traced to a specific file. Where the brief's assumption
differs from the code, the code wins and the difference is called out.

## Correction: the admin audience is `owner-admin`, not `admin`

The brief and the prior session summary both say the admin audience is `admin`.
The code says otherwise, in two independent places:

- `src/auth/auth.service.ts:390` → `audience: 'owner-admin'`
- `src/common/guards/jwt-auth.guard.ts:45` → `audience: 'owner-admin'`
- issuer is `'awexen'` at all three sign/verify sites

An implementation that signs `aud: 'admin'` produces tokens the existing guard
rejects — every admin login fails. This must come from the code, not the brief.

## Algorithm and configuration

| Property | Value | Source |
|---|---|---|
| Algorithm | HS256 | `JwtModule.registerAsync` default |
| Secret | `JWT_ACCESS_SECRET` | `auth.module.ts:14` |
| Access TTL | `15m` | `auth.module.ts:15` |
| Refresh TTL | `JWT_REFRESH_TTL_DAYS`, default **30** | `auth.service.ts:395` |
| Access lifetime (hardcoded) | 900 s | `auth.service.ts:21` |
| Admin audience | `owner-admin` | `auth.service.ts:390` |
| Portal audience | `customer-portal` | `customer-jwt.guard.ts:49` |
| Issuer | `awexen` | all three sites |

The secret is **shared** by both audiences. That is exactly why the audience
claim is the only thing separating the two identity spaces.

## Token claims (admin)

```ts
{ sub: number, email, name, roles: string[], perms: string[], sid?: number, typ: 'access' }
```

`typ` is checked (`jwt-auth.guard.ts:53`) **in addition to** the audience.
Both must pass.

## Refresh tokens

- Opaque, 48 random bytes, **base64url** (`security.service.ts:57`).
- Stored as **SHA-256 hex only** — the raw token is never persisted.
- `familyId` (UUID v4) links a rotation chain, enabling reuse detection.
- Rotation on every refresh.

Cookie: name **`owner_rt`**, `httpOnly`, `path: '/api/v1/auth'`, `secure` and
`sameSite: 'strict'` in production, `lax` otherwise, `maxAge` = refresh TTL.
Cleared with the same `path` — changing the path on logout would leave the
cookie in place.

## Two login flows, deliberately different

| | Admin | Portal |
|---|---|---|
| Endpoint | `POST /auth/login` | `POST /portal/login` |
| Throttle | **5 / 60 s** | 300 / 60 s |
| Guard | `JwtAuthGuard` | `CustomerJwtGuard` |
| Claims | roles + perms | sub, email, name |
| 2FA | yes (TOTP) | no |

The admin throttle is 60× stricter. Preserve it: the admin endpoint is the one
that can issue licences for every customer.

## Rate limits actually configured

| Route | Limit | Window |
|---|---|---|
| `POST /auth/login` | 5 | 60 s |
| `POST /auth/refresh` | 30 | 60 s |
| `POST /auth/forgot-password` | 5 | 300 s |
| `POST /auth/reset-password` | 10 | 300 s |
| `POST /portal/register` | 5 | 300 s |
| `POST /portal/login` | 300 | 60 s |
| `POST /validations/validate` | 60 | 60 s |

A per-account lockout sits beside the throttler: 5 failures →
`lockedUntil = now + 15 min` (`auth.service.ts:19-20`).

The 429 message is rewritten in the exception filter to name the 60-second

## Guard ordering — load-bearing

```
Throttle → JwtAuthGuard → PermissionsGuard
```

`@Public()` is a metadata flag read by `JwtAuthGuard` via `Reflector`
(`jwt-auth.guard.ts:25-29`). A literal port must keep `@Public()` on
`/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`,
`/portal/*` public routes, `/validations/validate`, `/releases/latest`,
`/health`, `/public-key`.

Getting this wrong returns 401 for legitimately signed-in users — and, worse,
could leave a portal route protected by the wrong audience.

## Permission model

`Admin → AdminRole → Role → RolePermission → Permission`. Permissions resolve
to a flat `string[]` of `permission.key` values, computed at login and embedded
in the JWT.

`PermissionsGuard` semantics (`permissions.guard.ts`):

- No `@RequirePermissions` → allow.
- `SUPER_ADMIN` in `roleKeys` → allow unconditionally (escape hatch).
- Otherwise **all** listed permissions required (AND, not OR).
- 403 body includes `details: { required, missing }`.

`SUPER_ADMIN` bypass is deliberate and every such action is still audited. A
Laravel Gate must reproduce the bypass, not rely on a package default.

## Password hashing

```
argon2id, memoryCost 19456 (19 MiB), timeCost 2, parallelism 1
input = plain + "::" + PASSWORD_PEPPER
```

`security.service.ts:6-10`, `:37-39`. The pepper is appended **before** hashing.
`argon2.verify(hash, peppered)` — argument order is (hash, digest).

Laravel's `Hash` facade cannot verify these PHC strings with its default config;
a custom hasher is required.

If `PASSWORD_PEPPER` is empty the pepper is skipped entirely (`:38`) — the code
degrades to unpeppered hashing rather than failing. Laravel must match this, or
a deployment with an empty pepper will produce hashes the other side cannot
verify.

## Account enumeration resistance

- Unknown email and wrong password return the **same** 401 message.
- `INACTIVE` → 403, `LOCKED` → 401 with a distinct message (an intentional,
  minor trade-off).
- Every attempt is written to `login_attempts`, success or failure.

## 2FA (TOTP)

- Secret: 20 random bytes → unpadded base32, 32 chars (RFC 4648).
- RFC 6238, 30 s step, 6 digits, ±1 window, HMAC-SHA1.
- Stored **encrypted** at rest: AES-256-GCM, layout
  `base64( iv[12] | authTag[16] | ciphertext )`.
- Key derivation: `sha256(JWT_ACCESS_SECRET + "::2fa")`.

Note that last line: the 2FA key is **derived from the JWT secret**, so rotating
`JWT_ACCESS_SECRET` would silently break every stored 2FA secret. Flag this to
whoever owns secrets management before that secret is ever rotated.

## Auth actions written to the audit log

`auth.login`, `auth.login_failed`, `auth.logout`, `auth.logout_all`,
`auth.password_changed`, `auth.password_reset_requested`,
`auth.password_reset`, `auth.2fa_enabled`, `auth.2fa_disabled` — each through
`AuditService.record()` with actor, IP, and request ID.

## Migration checklist for auth

- [ ] Sign `aud: 'owner-admin'`, verify same; portal `aud: 'customer-portal'`.
- [ ] Issuer `awexen` on both.
- [ ] `typ: 'access'` checked on admin tokens.
- [ ] Access TTL 15 m; `expiresIn: 900` returned.
- [ ] Refresh cookie `owner_rt`, httpOnly, `path=/api/v1/auth`, sameSite rules.
- [ ] Refresh stored as SHA-256 only, with `familyId` reuse detection.
- [ ] Custom Argon2id hasher, `m=19456,t=2,p=1`, pepper prepended.
- [ ] Empty-pepper fallback matches the original.
- [ ] All seven throttles reproduced.
- [ ] Lockout: 5 attempts, 15 minutes.
- [ ] Identical 401 for unknown email and bad password.
- [ ] `SUPER_ADMIN` bypass, AND semantics for multiple permissions.
- [ ] TOTP RFC 6238 vectors; AES-256-GCM layout preserved.
- [ ] Guard order throttle → JWT → permissions.
- [ ] `@Public()` set on the public routes.

window, because the generic throttler text is unactionable in the Arabic UI
(`all-exceptions.filter.ts:103-110`). Reproduce the intent, not the wording.
