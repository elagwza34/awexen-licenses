# RSA licence-signing compatibility

The desktop client verifies licences **locally with the RSA public key**. A
server rewrite is therefore only safe if the signatures it produces are
byte-identical to the ones the existing client accepts.

This document records the exact contract so a future implementation — in any
language — can be checked against it rather than against a guess.

## Key

| Property | Value |
|---|---|
| Type | RSA |
| Size | **3072 bits** (verified on the live key) |
| Public exponent | 65537 |
| Private key encoding | PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`) |
| Public key encoding | SPKI PEM (`-----BEGIN PUBLIC KEY-----`) |
| Location | `LICENSE_PRIVATE_KEY_PATH` (default `keys/license-private.pem`) |

The private key is a production secret. It is never regenerated, never
returned by an endpoint, never sent to the browser and never committed.

## Signature algorithm

**RSASSA-PKCS1-v1_5 with SHA-256.**

- Node: `crypto.sign('sha256', data, privateKeyPem)`
- PHP: `openssl_sign($data, $signature, $key, OPENSSL_ALGO_SHA256)`

**Not** PSS, and **not** a raw `openssl_sign()` with the default algorithm.
PKCS#1 v1.5 is deterministic, so two runs over the same bytes yield the same
signature — which is what makes a cross-language equality test meaningful.

## Canonical payload

The signed bytes are a JSON object with a **fixed key order**, produced by
`JSON.stringify`:

```js
JSON.stringify({
  licenseKey: payload.licenseKey,
  planKey:    payload.planKey,
  edition:    payload.edition,
  features:   [...payload.features].sort(),   // sorted
  maxDevices: payload.maxDevices,
  issuedAt:   payload.issuedAt,
  expiresAt:  payload.expiresAt,              // null when perpetual
  version:    payload.version,
})
```

Only what the client needs to run is included — no internal ids, no customer
PII.

- `features` is sorted so the signature does not depend on feature insertion
  order.
- `expiresAt` is `null` for a perpetual licence, not omitted.
- `issuedAt` is ISO-8601 with milliseconds and a `Z` suffix.

## Encoding gotcha (the one that matters)

`JSON.stringify` does **not** escape forward slashes. PHP's `json_encode`
**does**, by default:

| Input | `JSON.stringify` | `json_encode` (default) |
|---|---|---|
| `inventory` | `"inventory"` | `"inventory"` |
| `acme/corp` | `"acme/corp"` | `"acme\/corp"` |

The second row produces different bytes, hence a **different signature that
fails verification**. A correct implementation must therefore use:

```php
json_encode($ordered, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
```

This failure is easy to miss in testing: fixtures like `PRO` and `inventory`
contain no slash, so a test suite passes and production breaks the first time a
plan key or edition contains one. **Any fixture set used to validate a rewrite
must include a value with `/`.**

## Signature and hash encodings

| Value | Encoding |
|---|---|
| `signature` | **standard base64** (`+` / `/`, padded) — *not* base64url |
| `payloadHash` | SHA-256 of the canonical string, **hex** |

Verified against the current implementation; the sample signature begins
`EIB7dwPLwIF2nimtsxwRbjXD3kTIhs8vkGGBR+mnynXI…`.

## Verification checklist for a replacement implementation

1. `openssl_sign` with `OPENSSL_ALGO_SHA256` over the canonical string.
2. The canonical string is compared **as text** against Node's output before any
   signature comparison — a mismatch in the bytes is the real failure and is
   easy to misdiagnose as a key problem.
3. A licence issued by the old backend verifies under the new public-key path.
4. A licence issued by the new backend verifies under the **existing desktop
   client** unchanged.
5. A fixture containing `/` in at least one field is part of the suite.

`backend/tools/verify-signing.js` performs step 1 and 2 in both directions
(requires `php` on `PATH`).
