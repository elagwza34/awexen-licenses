# Permissions analysis

## Model

```
Admin ──< AdminRole >── Role ──< RolePermission >── Permission
```

Four tables, no package. `Role` and `Permission` are both keyed by a unique
`key` string (e.g. `SUPER_ADMIN`, `licenses.view`) — the **key**, not the
integer id, is the business identifier and the one that appears in the JWT and
in `@RequirePermissions()`.

## Resolution

At login, `AuthService.login()` eager-loads:

```ts
roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }
```

then flattens to a deduplicated `string[]` via a `Set` (`auth.service.ts:429`):

```ts
private permissionsOf(roles) {
  const set = new Set<string>();
  for (const r of roles) for (const p of r.role.permissions) set.add(p.permission.key);
  return [...set];
}
```

That array is embedded in the JWT as `perms`, alongside `roles` as `roleKeys`.

**Consequence to preserve:** permission changes do **not** take effect until
the admin's access token expires (15 min) or they re-login. The JWT is the
source of truth at request time — the guard does **not** re-query the database
on every request. A Laravel port that reads permissions from the database
per-request would be *more* correct but behaviourally different, and would add a
query to every single request. Match the existing behaviour.

## Guard semantics

`permissions.guard.ts`

| Condition | Result |
|---|---|
| No `@RequirePermissions` on handler or class | allow |
| `roleKeys` includes `SUPER_ADMIN` | allow, unconditionally |
| All required keys present in `perms` | allow |
| Any missing | **403** + `details: { required, missing }` |
| No authenticated admin | 403 `Authentication required` |

Semantics are **AND** — every listed permission is required. The decorator
docblock states this explicitly.

`SUPER_ADMIN` is an intentional escape hatch; the comment notes that every such
change is still audited. Reproduce the bypass rather than delegating to a
package default, which would change the audit story.

## Verified permission keys

Read off the controllers (each `@RequirePermissions` occurrence):

`admins.view`, `admins.update`, `analytics.view`, `audit.view`,
`activations.view`, `customers.view`, `customers.create`, `customers.update`,
`customers.delete`, `devices.view`, `devices.reset`, `features.view`,
`features.create`, `features.update`, `features.delete`, `licenses.view`,
`licenses.create`, `licenses.update`, `licenses.revoke`, `licenses.suspend`,
`licenses.renew`, `payments.view`, `payments.create`, `payments.verify`,
`payments.refund`, `plans.view`, `plans.create`, `plans.update`, `plans.delete`,
`releases.view`, `releases.create`, `releases.publish`, `settings.view`,
`settings.update`, `subscriptions.view`, `subscriptions.create`,
`subscriptions.update`, `support.view`, `support.update`, `validations.view`.

**Gaps to confirm against `permissions` table data before porting:** no
`invoices.*` or `payments.refund` alternative is visible in controllers, and
`licenses.*` is only partially covered. The controllers are not the whole
permission vocabulary — `prisma/seed.ts` and the `permissions` table hold the
rest. Read those rather than trusting this list as complete.

## Role keys

`AdminRoleKey`: `SUPER_ADMIN`, `ADMIN`, `SUPPORT_AGENT`, `FINANCE`, `VIEWER`.
Only `SUPER_ADMIN` has code-level significance (the bypass); the rest are
resolved purely through their permission rows.

## Laravel port options

**Recommended: no package.** A Gate plus a small middleware reproduces the
behaviour exactly and adds no behavioural drift:

```php
// app/Providers/AuthServiceProvider.php
Gate::before(fn ($admin) => $admin->hasRoleKey('SUPER_ADMIN') ? true : null);
```

`Gate::before` returning `null` (rather than `false`) on a non-match is
important — returning `false` would deny everything for non-super-admins.

Read `perms` from the JWT, **not** the database, to preserve current behaviour.
That argues for a custom middleware over `Gate::allows()`, since the Laravel
token guard resolves the user from the database by default.

A package such as Spatie `laravel-permission` would introduce its own caching,
its own model tables, and a different guard model. It would also be
reversible-in-principle but risky in practice, and the brief says not to
install one unless necessary. It is not necessary.

## Porting checklist

- [ ] Keys read from JWT `perms`, no per-request DB hit.
- [ ] AND semantics, `SUPER_ADMIN` bypass.
- [ ] 403 body includes `details: { required, missing }`.
- [ ] Missing-auth case returns 403, not 401.
- [ ] No-auth decorator case allows through.
- [ ] Full permission vocabulary read from `permissions` table + `seed.ts`.
- [ ] No permission package installed.
- [ ] Role→permission resolution deduplicated via a set.
- [ ] Documented that permission changes take up to 15 min to apply.
