# Migration plan

## Status: Phase 0/1 complete, awaiting validation

Steps 1–2 of §50 are done. **Step 3 (architectural validation) is the current
gate — no Laravel code has been written, per the brief's own ordering.**

## What has been produced

| Document | Contents |
|---|---|
| `ARCHITECTURE_ANALYSIS.md` | stack, 18 modules, pipeline, env vars, integrations |
| `DATABASE_ANALYSIS.md` | 24 models, 24 enums, 11 without `updatedAt`, porting traps |
| `AUTHENTICATION_ANALYSIS.md` | JWT, audiences, refresh rotation, Argon2, 2FA, throttles |
| `PERMISSIONS_ANALYSIS.md` | 4-table model, guard semantics, verified permission keys |
| `LICENSE_ENGINE_ANALYSIS.md` | lifecycle, transaction boundaries, status matrix, fingerprint |
| `RSA_COMPATIBILITY.md` | signing contract + **executed cross-language test** |
| `SCHEDULED_JOBS_ANALYSIS.md` | 4 jobs, advisory lock `1280758757`, Laravel mapping |
| `SECURITY_ANALYSIS.md` | all controls, plus 5 recorded weaknesses |

Supporting: `MIGRATION_ANALYSIS.md` and `LICENSE_COMPATIBILITY.md` at the repo
root, and the runnable probe `backend/tools/verify-signing.js`.

## Environment findings

| Item | Status |
|---|---|
| PHP | **8.2.12** at `C:\xampp\php\php.exe`, with `openssl` — below the 8.3 target |
| `php` on `PATH` | **no** (found by the probe's fallback list) |
| Composer | **not installed** |
| `pgsql` extension | **absent** from the XAMPP build |
| Node | 24.19.0, working |

Consequences:

1. **The RSA cross-check ran anyway** — it needs only `openssl`, which is
   present. Result: 8/8 cases match, including four slash-bearing ones. The
   PHP version does not affect `json_encode` string building, so the finding
   holds; re-run on 8.3 for formality.
2. **Laravel cannot be installed yet** — Composer is absent and PHP is 8.2.
3. **A local database connection is impossible** until `php_pgsql` is enabled,
   which usually means replacing the XAMPP build.

To proceed: install PHP 8.3+ with `openssl`, `pgsql`, `mbstring`, `bcmath`,
`intl`, `curl`, plus Composer 2.

## Risks, ranked

### 1 — Signature byte compatibility (critical, partially retired)

The failure mode is licences that verify nowhere. **Mitigated:** the exact
canonicaliser is known, the flag is identified, and Node↔PHP agreement is now
demonstrated on 8 cases including slashes, Arabic, backslashes, and nulls.

Residual risk: the Laravel implementation and the shipped desktop client are
still untested. That needs a running app.

### 2 — Model/table fidelity (high)

24 models, 24 enums, **11 without `updatedAt`**, one string PK. A default
`$timestamps = true` on those eleven breaks writes immediately. Mitigated by
the explicit list in `DATABASE_ANALYSIS.md`.

Also note the brief said 23/23 — it is 24/24. A checklist using the brief's
numbers would declare completion with `Invoice` missing.

### 3 — Transaction semantics (high)

`approveActivation` commits payment and licence creation **separately**, on
purpose. Wrapping both in one Laravel transaction would invert a deliberate
safety property: a signing failure could then roll back a confirmed payment.
Verified across 9 transaction/resign pairs.

### 4 — Audience separation (high)

One secret, two audiences; the `aud` claim is the only separator. Note the
correction: the admin audience is `owner-admin`, **not** `admin` as the brief
states. Signing the brief's value produces tokens the existing guard rejects.

### 5 — Argon2 + pepper (high)

A custom hasher is unavoidable. The empty-pepper fallback must be reproduced or
hashes produced under one deployment will not verify under another.

### 6 — Advisory lock under cron (medium)

The current design holds a session-scoped lock for the process lifetime.
`schedule:run` has no long-lived process, so the lock must be re-acquired per
tick on a dedicated connection. Using the request-scoped PDO connection would
release it immediately and let every instance believe it is the leader.

### 7 — Validation strictness (medium)

`whitelist` + `forbidNonWhitelisted` is a mass-assignment defence that Laravel
does not provide by default. Loosening it would be invisible to functional tests.


## Sequencing after validation

1. Install PHP 8.3+ (with `pgsql`) and Composer 2.
2. Re-run `node tools/verify-signing.js` on 8.3.
3. Diff live Neon schema against `schema.prisma`.
4. Scaffold Laravel 12 in a **separate** directory, pointing at a non-production
   database.
5. Eloquent models — start with the 11 timestamp-less ones and `Setting`.
6. Auth (JWT both audiences, refresh rotation, Argon2 hasher) against fixtures.
7. Permissions, then the licence engine.
8. RSA: sign in PHP, verify with Node **and** the shipped desktop client.
9. Remaining controllers, then the four scheduled jobs.
10. Node-vs-Laravel comparison suite; green before any cutover.
11. Staging on the same schema, frontend and offline client tested.
12. Cutover only on explicit sign-off, with a documented rollback to the Node
    image.

## Explicitly out of scope

Per Rule 4, these are findings, not changes to make during a port:

- the 2FA key derived from `JWT_ACCESS_SECRET`;
- the 2048-bit dev keygen fallback;
- the 300/min portal login throttle;
- the `INACTIVE`/`LOCKED` enumeration side-channel;
- Swagger mounted at `api/docs` when `NODE_ENV !== production`.

Each is a product decision. Fixing them silently would make Laravel a
*different* system, and the compatibility tests would be measuring the wrong
thing.

## Definition of done

Per §49, `php artisan serve` is not sufficient. The binding items are:

- existing Neon schema untouched and compatible;
- existing admin and customer passwords verify;
- refresh rotation and reuse detection behave identically;
- **every licence issued by the old backend still verifies**;
- **new licences verify in the already-installed desktop client**;
- signature bytes match Node exactly on slash-bearing payloads;
- the four jobs run once per tick across replicas;
- frontend unchanged;
- rollback documented and rehearsed.
