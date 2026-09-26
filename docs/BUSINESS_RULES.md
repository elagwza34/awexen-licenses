# Business Rules

These are enforced in code, not left to the UI. Each rule lists where it lives
so it can be audited.

## 1. Expired licences are never deleted

**Where:** `LicensesService` has no delete method. `LicenseStatusService.reconcileAllLicenses()`
only transitions status.

An expired licence is a permanent record of a customer relationship. Deleting
it would destroy revenue history and the ability to explain what happened.

## 2. Suspended licences stay in history and are reversible

**Where:** `LicensesService.suspend()` / `reactivate()`

Suspend sets `status = SUSPENDED` plus `suspendedAt` / `suspendedReason`, keeps
every device and activation record, and writes an audit entry. Reactivation
restores the status the licence *should* naturally have — reactivating an
expired licence yields EXPIRED, not a resurrected ACTIVE.

## 3. Revoked licences cannot be silently reactivated

**Where:** `LicensesService.revoke()` / `reactivate()` — the latter throws
`ConflictException` for `REVOKED`.

`REVOKED` is terminal. Revocation also revokes all devices and cancels the
bound subscription, so the customer app cannot keep validating through a
sibling licence. Recovery means issuing a **new** licence with `reissueOfId`
pointing at the original, preserving the chain.

## 4. Device resets are always logged

**Where:** `LicensesService.resetDevice()`

Inside one transaction the service revokes the device, writes a
`DEVICE_RESET` activation record, and writes an audit entry. The device row is
revoked, never deleted, so the activation history stays coherent.

## 5. Renewal is always audited

**Where:** `LicensesService.renew()` — the audit row shares the transaction

Records old and new `expiresAt`, the status change, the billing interval, the
number of periods and the reason.

## 6. Payment verification is always audited

**Where:** the payments module (Phase 2), same `AuditService.record()` pattern

`payments.verify` is a distinct permission from `payments.view`, and refunds
are separate again, so a finance user cannot silently alter a ledger.


## 7. Plan changes are always logged

**Where:** `LicensesService.changePlan()`

Captures old and new plan ids, the device-limit change, the subscription's
proration mode, and an explicit note that proration is not computed
automatically.

**No invented proration.** The mode comes from the subscription/settings; the
admin confirms the resulting charge manually. A downgrade is refused while
more devices are active than the new plan allows, so a customer is never
silently over their limit.

## 8. Payment records are never destructively modified

**Where:** `payments` module (Phase 2)

Refunds set `refundedAmount` and `refundReason` on the original row and record
a compensating entry. No amount is ever overwritten. `transactionReference` is
`UNIQUE`, so the same bank transfer cannot be imported twice.

## 9. The signing private key is never exposed

**Where:** `LicenseCryptoService`

- Loaded from a file at boot into process memory.
- No endpoint returns it; `GET /api/v1/public-key` returns only the public key.
- Excluded from the frontend build and from git (`.gitignore` covers `*.pem`,
  `keys/`).
- In Docker it is mounted read-only, never copied into a layer.
- `findOne()` strips `signature` and `payloadHash` from admin responses.

## 10. Frontend permissions are never trusted

**Where:** `PermissionsGuard` (global `APP_GUARD`)

The UI hides actions with `can()`, but authorisation happens on the server for
every route. A request without the permission gets 403 regardless of what the
SPA sent. The global ValidationPipe additionally strips unknown fields, which
blocks mass-assignment of `status` or `roleId`.

## 11. Backend authorisation is mandatory

**Where:** `@RequirePermissions('resource.action')` on every non-public route

All listed permissions must be present (AND semantics). `SUPER_ADMIN` bypasses
by design — but every action is still written to the audit trail.

## 12. Licence status is always determined server-side

**Where:** `LicenseStatusService.derive()` — the single source of truth

The stored `status` column is a cache. The UI shows `derivedStatus` and the
public validation endpoint calls `derive()` live, so a stale row can never make
an invalid licence look active.

## 13. The owner panel is the source of truth

Licence state lives only in PostgreSQL. The customer application holds a
**signed** payload plus a lease (`validUntil`) and never writes licence state
of its own. Any change to a plan, feature set, expiry or device limit is
re-signed server-side.

---

## Configurable, not hardcoded

| Setting key | Default | Effect |
| --- | --- | --- |
| `license.validation_interval_hours` | 72 | How long the client may run without re-validating |
| `license.grace_period_days` | 7 | Days a licence still works after expiry |
| `license.expiring_window_days` | 14 | When a licence is flagged EXPIRING |
| `license.default_max_devices` | 1 | Device slots when a plan is silent |
| `trial.default_days` | 14 | Trial length fallback |
| `trial.default_plan_key` | BASIC | Plan used when starting a trial |
| `billing.default_currency` | EGP | ISO code for new plans and payments |
| `security.require_two_factor` | false | Force 2FA for non-owner admins |
| `notifications.expiry_warning_days` | 7 | Renewal reminder lead time |
| `notifications.payment_followup_days` | 3 | Pending-payment follow-up window |

These live in the `settings` table, are editable from the panel, and are
pushed into the live services on save — no restart required. Sensitive values
are never returned in full and every change is audited.

## Known gaps (deliberate, not accidental)

1. **Proration is not implemented.** The mode is stored and surfaced; the
   calculation is left to the admin. Inventing a formula would be a business
   decision, not a technical one.
2. **No email/WhatsApp delivery.** Notifications use an outbox table; providers
   plug in later.
3. **No automatic updates.** Validation reports the published version and
   whether an update is required; it never downloads or executes anything.
4. **Password reset has no email transport.** Tokens are written to the
   notification table and the API always returns a generic message so accounts
   cannot be enumerated.
5. **Scheduled reconciliation has no cron entry yet.**
   `reconcileAllLicenses()` is implemented and idempotent, but until a `@Cron`
   registration is added, expiry statuses only change when a request touches
   the licence.
6. **No automated Jest suite yet.** `npm run verify` (34 crypto checks) and
   `npm run verify:business` (28 status-rule checks) run standalone and cover
   the security-critical logic, including the RFC 6238 vectors and the whole
   status matrix. They are not yet wired into Jest, and there is no integration
   test against a live database.
7. **No database has been connected yet.** Migrations and the seed script are
   written but unexercised in this environment; the API has only been verified in
   degraded (database-down) mode.

