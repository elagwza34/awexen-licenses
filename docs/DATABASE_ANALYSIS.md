# Database analysis

Source of truth: `backend/prisma/schema.prisma` (834 lines) plus two
migrations in `backend/prisma/migrations/`. Every count below was verified by
reading the file, not estimated.

## Verified counts

Counted mechanically from the file, not estimated:

| Claim in the brief | Actual | Note |
|---|---|---|
| ~23 models | **24 models** | `Invoice` is easy to miss |
| ~23 enums | **24 enums** | includes `ProrationMode` |

A checklist expecting 23 will sign off "complete" with a model missing. Use 24
as the reconciliation number.

## Conventions, as encoded in the file header

The schema states its own rules, and the code follows them:

- Money is stored as **integer minor units** plus a separate ISO currency column.
- All timestamps are `timestamptz` in UTC; formatting is a UI concern.
- Historical records are never destroyed.
- Enums are native Postgres types so the database rejects invalid states.

## Model → table inventory (24)

| Model | Table | Notes |
|---|---|---|
| `Activation` | `activations` | append-only, no `updatedAt` |
| `Admin` | `admins` | soft delete via `deletedAt` |
| `AdminRole` | `admin_roles` | join, no `updatedAt` |
| `AppVersion` | `app_versions` | release publishing |
| `AuditLog` | `audit_logs` | append-only, no `updatedAt` by design |
| `Customer` | `customers` | `userId` → portal account |
| `Device` | `devices` | unique (license, fingerprint) |
| `Feature` | `features` | `key` unique |
| `Invoice` | `invoices` | easily overlooked; money-bearing |
| `License` | `licenses` | `licenseKey` unique; signature + payload |
| `LicenseValidation` | `license_validations` | append-only, no `updatedAt` |
| `LoginAttempt` | `login_attempts` | append-only, no `updatedAt` |
| `Notification` | `notifications` | outbox, no `updatedAt` |
| `Payment` | `payments` | `amount`, `refunded_amount` minor units |
| `Permission` | `permissions` | `key` unique, no `updatedAt` |
| `Plan` | `plans` | `price` minor units + currency |
| `PlanFeature` | `plan_features` | join, no `updatedAt` |
| `RefreshToken` | `refresh_tokens` | no `updatedAt`; `revokedAt` nullable |
| `Role` | `roles` | `key` unique, no `updatedAt` |
| `RolePermission` | `role_permissions` | join, no `updatedAt` |
| `Setting` | `settings` | **string PK `key`**, has `updatedAt` |
| `Subscription` | `subscriptions` | |
| `SupportTicket` | `support_tickets` | no `updatedAt` |
| `SupportTicketMessage` | `support_ticket_messages` | append-only |

## Enums (24)

`ActivationType`, `AdminRoleKey`, `AdminStatus`, `AppVersionStatus`, `AuditEntity`,
`BillingInterval`, `CustomerStatus`, `DeviceStatus`, `FeatureCategory`,
`FeatureStatus`, `LicenseStatus`, `NotificationChannel`, `NotificationStatus`,
`PaymentMethod`, `PaymentStatus`, `PlanStatus`, `Platform`, `ProrationMode`,
`SettingType`, `SubscriptionStatus`, `TicketMessageType`, `TicketPriority`,
`TicketStatus`, `ValidationStatus`.

`ProrationMode` is the one most likely to be missed, and it only appears on
`Invoice`.

## Models WITHOUT `updatedAt` (11 of 24)

Verified by parsing each model block:

```
Permission        RolePermission   AdminRole      RefreshToken
LoginAttempt      PlanFeature      Activation     LicenseValidation
SupportTicketMessage               AuditLog       Notification
```

**This is the single highest-risk item in the port.** Laravel models default to
`public $timestamps = true`, which would emit `updated_at` on every one of
these eleven and fail against the real schema. Each needs
`public $timestamps = false;`.

Note `SupportTicket` (no `updatedAt`) and `SupportTicketMessage` (also none) —
the real model name is `SupportTicketMessage`, not `TicketMessage`.

## Laravel porting traps

1. **`$timestamps = false`** on all eleven models above.
2. **`Setting`**: `$primaryKey = 'key'`, `public $incrementing = false`,
   `protected $keyType = 'string'`.
3. **Enum columns** already exist as Postgres types. Map to PHP backed enums and
   `->cast()`. Do **not** run `CREATE TYPE` — that is a destructive migration
   against a live database.
4. **`plan_features` is a pivot** → `belongsToMany`. The licence canonical
   string reads feature keys through this join, so it affects the signature.
5. **`json` columns** (`old_value`, `new_value`, `metadata`, `value`, `payload`)
   must cast to `array` or Eloquent returns a string that double-encodes.
6. **Enum serialisation is SCREAMING_SNAKE** — Prisma emits enum values verbatim,
   so the API returns `"PAID"`, not `"paid"`. Preserve case exactly.
7. **Money**: `amount`, `refunded_amount`, `price` are `Int`. Never touch a
   `float` in a money path. `Invoice` also carries money fields.

## Migrations present

- `20260926091946_init` — bulk of the schema.
- `20260926210741_customer_portal_auth` — portal account tables.

Only two, so production has drifted little from the Prisma file. Still diff the
live Neon schema before generating Laravel migrations: Prisma is the declared
schema, not proof of the deployed one.

