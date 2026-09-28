# Licence engine analysis

## Lifecycle, as implemented

```
Plan ──► Subscription ──► Payment (PENDING)
                              │
                     approve-activation
                              │
              ┌───────────────┴───────────────┐
      payment → PAID              licences.create() → signed
      downloadEnabled = true       (OUTSIDE the transaction)
                              │
                     Device activation (fingerprint bound)
                              │
                     validate() (records every attempt)
                              │
              renew / extend / changePlan → resign()
                              │
              expire (scheduler) / suspend / revoke (admin)
```

`LicenseStatus`: `TRIAL`, `EXPIRING`, `ACTIVE`, `EXPIRED`, `SUSPENDED`,
`REVOKED` — **six states, not merged, no invented states.**

## The transaction boundary is deliberate and load-bearing

This is the most important structural fact in the engine, and it is easy to
"clean up" into a bug.

**Payment confirmation and RSA signing are NOT in the same transaction.**

`payments.service.ts:496` — the transaction covers exactly two things:

1. `payment.status = PAID`, `paidAt`, `verifiedById`, `verifiedAt`, `notes`
2. `customer.downloadEnabled = true`

Only **after** the transaction commits does the code resolve the plan
(`resolvePlanFor`) and call `licenses.create()`. If signing then fails, the
payment stays confirmed and the download stays enabled.

The in-code reasoning (`:509-510`) is explicit: the download gate belongs to
accepting the payment, and a licence failure must not revoke a payment the
customer genuinely made.

**A Laravel port that wraps `approve-activation` in one `DB::transaction()`
around both would silently change the failure semantics.** Do not.

The same pattern repeats throughout `licenses.service.ts`: every mutation commits
in a `$transaction` and then calls `resign()` **afterwards**, outside it
(lines 241, 274, 470, 518, 571, 660). Nine transactions, nine resigns, zero
signings inside a transaction.

## `approveActivation` flow in detail

`payments.service.ts:478`

1. Load payment with customer + subscription.
2. Reject if `REFUNDED` or `CANCELLED` → 409 `A {status} payment cannot be
   approved`.
3. If not already `PAID`, mark it paid inside the transaction.
4. Set `customer.downloadEnabled = true` — same transaction.
5. If `dto.issueLicense === false`, return early: payment confirmed, no licence.
6. Resolve the plan: `dto.planId`, else `payment.subscription.planId`, else an
   **exact price match** against active plans.
7. If the customer already has an `ACTIVE`/`TRIAL` licence on that plan, return
   it unchanged with an Arabic message — no duplicate licence.
8. Otherwise `licenses.create()`.
9. Return `{ payment, license, message }` — the message is **Arabic**.

`resolvePlanFor` (`:569`) is deliberately strict: an exact `price` match
required, and **ambiguity is an error**, not a guess.

> Several plans share this price. Pass planId to say which one was bought.

The comment explains why: falling back to "the most expensive plan" would hand
a customer a licence they did not pay for. Reproduce this refusal.

## Signing

`getSignedPayload` (`licenses.service.ts:126-143`) builds the payload then
calls `crypto.sign()`. `issuedAt` is `license.createdAt.toISOString()` — so a
licence's `issuedAt` is the **row's creation time**, not the signing time. A

## Device fingerprinting

`sha256( parts.join('|') + "::" + PASSWORD_PEPPER )` — hex
(`security.service.ts:74-78`).

`license-validation.service.ts:92` hashes the client-supplied fingerprint
**server-side** with the pepper, so a raw fingerprint is never stored and cannot
be reversed or replayed into a known value.

`validate()` also checks the device limit, returning
`ValidationStatus.DEVICE_LIMIT` when exceeded.

## Status derivation — pure functions, already pinned

`license-status.service.ts:64` `derive()` is pure. Its matrix is asserted in
`scripts/verify-business-rules.ts` against a fixed clock
(`2026-09-26T12:00:00.000Z`), so these values are **verified**, not guessed:

| Situation | Result |
|---|---|
| `SUSPENDED`, any expiry | `SUSPENDED` (admin wins) |
| `REVOKED`, unexpired | `REVOKED` (admin wins) |
| expired ≤ 7 days | `EXPIRING` (grace) |
| expired > 7 days | `EXPIRED` |
| expires within 14 days | `EXPIRING` |
| lifetime (`expiresAt = null`) | `ACTIVE` |
| `isTrial` | `TRIAL` |
| expired exactly *now* | **not** `EXPIRED` (inclusive boundary) |
| 1 second past expiry | `EXPIRING` (grace) |

Both windows (`graceDays` 7, `expiringDays` 14) are **configurable** via the
`settings` table, and the suite asserts 0-day, 30-day, and 90-day
configurations. A hardcoded port would pass the defaults and break the
tunability.

`daysRemaining()` floors, clamps at 0, returns `null` for lifetime.

## Validate response shape

`ValidateResponse` (`license-validation.service.ts:20-36`):

```ts
{ valid, status, message, validUntil, payload, signature, publicKey,
  serverTime, release: { latestVersion, minSupportedVersion, updateRequired,
                         downloadUrl } | null }
```

On **any** failure `buildResponse()` returns `payload: null`, `signature: null`,
`publicKey: null` — a blocked client learns nothing about its entitlements. That
is a deliberate information-disclosure control, not an oversight.

`validUntil` is how long the client may run **offline** before re-validating
(default 72 h, configurable). `serverTime` lets the client detect clock
tampering.

Version comparison (`compareVersions`, `:369`) is **numeric per segment**, not
lexicographic — `"1.10.0" > "1.9.0"`. A PHP string comparison fails here.

## Licence key format

`PREFIX-XXXX-XXXX-XXXX-XXXX`, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
(no I/O/0/1), generated by **rejection sampling** to avoid modulo bias
(`license-key.util.ts`).

`normalizeLicenseKey()`: trim → uppercase → `[\s_]+`→`-` → collapse repeats.

`maskLicenseKey()`: first 2 chars of each group then `*`. Used in logs and list
responses.

## Audited licence actions

`license.created`, `license.updated`, `license.renewed`, `license.extended`,
`license.suspended`, `license.reactivated`, `license.revoked`,
`license.plan_changed`, `license.device_reset`,
`license.status_reconciled` (scheduler, `adminId = null`).

## Porting checklist

- [ ] Six status states, no merging, no new states.
- [ ] `derive()` matrix matches the verified table, including the inclusive
      expiry boundary.
- [ ] Grace and expiring windows read from `settings`, not hardcoded.
- [ ] `approveActivation` keeps payment commit **outside** licence signing.
- [ ] `resolvePlanFor` requires an exact price match and refuses ambiguity.
- [ ] Duplicate active licence returns the existing one, not a new one.
- [ ] `issuedAt = createdAt.toISOString()`; `version` increments on re-sign.
- [ ] `resign()` called after the transaction, never inside.
- [ ] Fingerprint = `sha256(parts.join('|') . "::" . pepper)`.
- [ ] Failure responses null out payload, signature, and publicKey.
- [ ] Version comparison numeric per segment.
- [ ] Key alphabet excludes I/O/0/1; rejection sampling preserved.
- [ ] Arabic `message` strings returned verbatim by `approveActivation`.

re-sign keeps the original `issuedAt` while `version` increments. Getting this
wrong changes the canonical bytes and invalidates every existing licence.

`resign()` (`:873`) rebuilds and re-signs, bumping `version`.
