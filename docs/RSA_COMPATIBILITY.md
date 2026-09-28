# RSA compatibility — VERIFIED

This is the load-bearing constraint of the whole migration. The desktop client
verifies licences **offline** with an RSA public key that is already baked into
shipped installs. It cannot be redeployed in step with a server rewrite, and
already-issued licences must keep working. So the Laravel implementation is not
"similar enough" — it must be **byte-identical**.

## Status: cross-language check PASSED

```
$ node tools/verify-signing.js
key        : rsa, 3072-bit, e=65537n
[node ok] 8/8 cases self-verify
[MATCH   ] 8/8 cases — Node ↔ PHP agree

  Node and PHP agree on all 8 case(s), including every one with a slash.
  A Laravel canonicaliser using JSON_UNESCAPED_SLASHES is byte-compatible.
```

The PHP used was 8.2.12 (XAMPP) with `openssl`. The canonicaliser is plain
`json_encode` string building, so it is not version-sensitive; re-run against
PHP 8.3 when available.

## Key (read from disk, not assumed)

| Property | Value |
|---|---|
| Type | RSA |
| Modulus | **3072 bits** |
| Public exponent | **65537** |
| Private encoding | PKCS#8 PEM — `-----BEGIN PRIVATE KEY-----`, 2484 bytes |
| Public encoding | SPKI PEM — `-----BEGIN PUBLIC KEY-----`, 625 bytes |
| Private key path | `keys/license-private.pem` (2484 bytes) |

**Discrepancy worth knowing:** `scripts/verify-crypto.ts` generates a **2048-bit**
key for its own test (line 63: `modulusLength: 2048`) and its heading even says
`[1] License payload signing (RSA-2048)`. The real production key is 3072-bit.
The self-test therefore proves the *algorithm*, not the production key size. Do
not read that script's passing as evidence about 3072.

## Algorithm

**RSASSA-PKCS1-v1_5 with SHA-256.**

- Node: `crypto.sign('sha256', data, privateKeyPem)`
- PHP: `openssl_sign($data, $sig, $key, OPENSSL_ALGO_SHA256)`

Not PSS, not the `openssl_sign` default. PKCS#1 v1.5 is deterministic, which is
what makes an equality test between two languages meaningful at all.

An ed25519 branch exists in the service but is not in use: the key is RSA.

## Canonical payload

```js
JSON.stringify({
  licenseKey, planKey, edition,
  features: [...features].sort(),   // sorted — insertion order irrelevant
  maxDevices, issuedAt, expiresAt, version,
})
```

Only what the client needs to run: no internal ids, no customer PII.
`expiresAt` is `null` for a perpetual licence, not omitted.

## The slash trap — the one thing that must not be missed

`JSON.stringify` does not escape `/`. PHP's `json_encode` does, by default.
Measured on this machine:

```
node           : {"licenseKey":"PROD-X","edition":"Home/Office","features":["multi/branch"]}
php default    : {"licenseKey":"PROD-X","edition":"Home\/Office","features":["multi\/branch"]}
php with flag  : {"licenseKey":"PROD-X","edition":"Home/Office","features":["multi/branch"]}
```

Same input, different bytes, therefore a different signature, therefore a licence
the shipped client rejects. The required Laravel form is:

```php
$canonical = json_encode($ordered, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
```

This defect is **invisible to a naive test suite** — fixtures like `PRO` and
`inventory` contain no slash, so tests pass and production breaks on the first
plan key or edition containing one. That is why the probe includes four
slash-bearing cases, one combining a slash with Arabic text.

## Test matrix used by the probe

| Case | Covers |
|---|---|
| simple ascii | baseline |
| slash in edition | the primary trap |
| slash in planKey | second field that can carry one |
| slash in a feature key | reaches the `features` array |
| backslash, quotes, newline | `\\`, `"`, `\n` escaping |
| Arabic unicode | `JSON_UNESCAPED_UNICODE` necessity |
| slash AND Arabic | interaction of both flags |
| empty + zero + null expiry | empty string, `0`, `null` |

## Encodings

| Value | Encoding |
|---|---|
| `signature` | **standard base64** (384 bytes → 512 chars, padded). Not base64url |
| `payloadHash` | SHA-256 of the canonical string, **hex** (64 chars) |

## Reproduction

```bash
node tools/verify-signing.js                     # auto-detects PHP
node tools/verify-signing.js <priv.pem> <php.exe>
```

Exit `0` = agreement, `1` = mismatch, `2` = PHP not found. Scratch files are
written to `%TEMP%`, never inside the repo — the probe handles a private key,
and writing it next to tracked source risks committing it.

## Definition of done for the signing work

1. Node-signed payloads verify under PHP. **Done.**
2. PHP-signed payloads verify under Node and under the existing desktop client.
   **Not done** — requires running the Laravel build and the shipped client.
3. A slash-bearing licence issued by Laravel is accepted by an already-installed
   client. **Not done.**
4. A licence issued by the current Node backend is accepted by the Laravel
   verification path. **Not done.**

Items 2–4 need a running Laravel app, so they belong to Step 9 of the
execution order, not to this analysis phase.
