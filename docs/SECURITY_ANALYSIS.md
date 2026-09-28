# Security analysis

Controls verified in source, with the file that implements each.

## Authentication

| Control | Implementation |
|---|---|
| Password hashing | Argon2id `m=19456, t=2, p=1`, pepper **prepended** — `security.service.ts:6-10,37-39` |
| Pepper | `plain + "::" + PASSWORD_PEPPER`; empty pepper degrades to unpeppered |
| Password policy | ≥12 chars, lower, upper, digit, symbol — `assertPasswordStrength` |
| Access token | HS256, 15 m, audience-pinned |
| Refresh token | 48 random bytes, base64url, **SHA-256 stored only** |
| Refresh cookie | `owner_rt`, httpOnly, `path=/api/v1/auth`, strict in prod |
| Reuse detection | `familyId` chain; replay revokes the family |
| Account lockout | 5 failures → 15 min |
| 2FA | TOTP RFC 6238, secret AES-256-GCM encrypted at rest |
| Enumeration | identical 401 for unknown email and bad password |

## Authorisation

- Two audiences sharing one secret; the `aud` claim is the **only** separator.
  Both guards pin it, and the code comments explain the escalation each way
  (`customer-jwt.guard.ts:23-36`). This is the highest-value control in the
  system: an admin token accepted at a portal endpoint, or vice versa, is a
  privilege escalation.
- `SUPER_ADMIN` bypass, by design, audited.
- AND semantics on permission lists.
- Customer data is scoped by `customerId` from the portal token, never from
  request input. `GET /portal/requests/:id/receipt` additionally returns **404
  rather than 403** for another customer's receipt, so existence is not leaked.

## Cryptography

| Purpose | Algorithm | Notes |
|---|---|---|
| Licence signing | RSASSA-PKCS1-v1_5 / SHA-256 | RSA 3072, e=65537 |
| Signature encoding | standard base64 | **not** base64url |
| 2FA secret at rest | AES-256-GCM | `iv[12] \| authTag[16] \| ct`, base64 |
| Device fingerprint | SHA-256 + pepper | raw fingerprint never stored |
| Refresh token at rest | SHA-256 | raw never stored |
| TOTP | HMAC-SHA1, RFC 6238 | 30 s, 6 digits, ±1 |

**Key handling.** `license-private.pem` (2484 bytes, PKCS#8) sits in
`backend/keys/`. It is loaded at boot, held in memory, and never returned by any
endpoint. `LicenseCryptoService.onModuleInit()` throws in production if it is
missing, but **auto-generates a 2048-bit key in development** (`:52-57`).

Two things to flag:

1. That dev fallback is 2048-bit, not 3072. A developer who loses the key
   locally ends up with a weaker key and a mismatch against shipped clients.
2. `backend/keys/` must never be committed. Verify it is git-ignored, and
   confirm the private key is not currently tracked in history.

## Transport and headers

`main.ts`

- `helmet()` with CSP **disabled** (the SPA is served separately by Nginx),
  `crossOriginEmbedderPolicy: false`, HSTS `maxAge=31536000`,
  `includeSubDomains: true`, `preload: true`.

## CORS

```ts
origin: CORS_ORIGINS.split(',').map(trim)   // never '*'
credentials: true
methods: GET POST PUT PATCH DELETE OPTIONS
allowedHeaders: Content-Type, Authorization, X-Request-Id
exposedHeaders: X-Request-Id
maxAge: 3600
```

`credentials: true` is required for the refresh cookie. A wildcard origin is
therefore **not** an option. In Laravel: `supportsCredentials` plus an explicit
origin list. `allowed_origins_patterns: ['*']` combined with credentials would
be a regression.

## Validation

Global `ValidationPipe` (`main.ts:46-54`):

| Option | Value | Effect |
|---|---|---|
| `whitelist` | `true` | strips unknown properties → blocks mass assignment |
| `forbidNonWhitelisted` | `true` | **rejects** unknown properties with 400 |
| `transform` | `true` | DTO coercion |
| `enableImplicitConversion` | `false` | no surprise type coercion |
| `validationError` | `target: false, value: false` | errors omit the payload |

The combination of whitelist **and** forbid is a mass-assignment defence.
Laravel's Form Requests do not strip by default — `prohibited` rules or
explicit per-request whitelisting are needed to match. Loosening this to ignore
unknown keys is a silent security regression that functional tests will not
catch.

## Error handling

`AllExceptionsFilter` guarantees one shape and never leaks internals.

Prisma error mapping:

| Code | HTTP | `error.code` |
|---|---|---|
| `P2002` | 409 | `DUPLICATE_RECORD` |
| `P2003` | 400 | `FK_VIOLATION` |
| `P2025` | 404 | `NOT_FOUND` |
| other known | 500 | `DB_ERROR` |
| validation | 400 | `DB_VALIDATION_ERROR` |

Never exposed: SQL, stack traces, env vars, private keys, filesystem paths.
≥500 logs the stack server-side; <500 logs a warning only.

Laravel must not emit `whoops` output, and `APP_DEBUG` must be `false` in
production. The default Laravel 422/500 JSON shapes must be **replaced** by this
envelope, not merged with it.

## Environment validation

`env.validation.ts` refuses to boot on bad config. Unconditional:
`DATABASE_URL` present, `JWT_ACCESS_SECRET` ≥ 32 chars. In production
**additionally**: `PASSWORD_PEPPER` ≥ 16, `CORS_ORIGINS` not the localhost
default, `SERVER_NAME` not `admin.example.com`.

A misconfigured deployment fails loudly rather than silently weakening
security. Reproduce this in Laravel config validation.

## Known weaknesses — to record, not to fix silently

Per Rule 4 these are findings to report; changing them is a product decision,
not part of a faithful port:

1. **2FA key derived from `JWT_ACCESS_SECRET`** (`security.service.ts:82`).
   Rotating the JWT secret silently invalidates every stored 2FA secret. Should
   be a dedicated `TOTP_ENCRYPTION_KEY`.
2. **The crypto self-test uses 2048-bit RSA** while production is 3072-bit, so
   the test does not cover the real key size.
3. **Portal login throttle is 300/min** — 60× looser than admin.
4. **Login enumeration side-channel:** `INACTIVE` → 403 and `LOCKED` → 401
   differ from the generic 401, revealing account state.
5. **Argon2 at 19 MiB** is the OWASP baseline, but on a 512 MB Fly machine
   concurrent logins could pressure memory.

## Migration security checklist

- [ ] Argon2id custom hasher, `m=19456,t=2,p=1`, pepper prepended.
- [ ] Empty-pepper fallback matches.
- [ ] `aud` pinned on both guards.
- [ ] Refresh tokens hashed at rest, cookie flags identical.
- [ ] 404-not-403 for other customers' receipts.
- [ ] Whitelist **and** forbid unknown properties.
- [ ] Helmet equivalent, CSP off, HSTS on.
- [ ] CORS explicit origins, credentials true, `X-Request-Id` exposed.
- [ ] Prisma error codes → 409/400/404/500 mapping.
- [ ] `APP_DEBUG=false`; no stack traces in responses.
- [ ] Config validation refuses to boot when misconfigured.
- [ ] `backend/keys/` git-ignored; private key never committed or logged.
- [ ] `trust proxy` equivalent for correct client IPs.

- `cookie-parser` mounted.
- `trust proxy` = 1 when `TRUST_PROXY=true` — required for correct `req.ip`
  behind the reverse proxy. Audit entries and lockouts depend on this, so a
  mis-set `TRUST_PROXY` means every recorded IP is the proxy's.
