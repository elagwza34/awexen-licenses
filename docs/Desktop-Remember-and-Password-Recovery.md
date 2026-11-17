# PMS desktop remember-me and owner password recovery

## Customer behavior

Select **تذكرني على هذا الكمبيوتر** during normal desktop sign-in. The application stores only a DPAPI-protected refresh token scoped to the Windows profile, computer and configured API/company installation. It does not store the password or trust saved roles. After the existing licensing gate, startup exchanges that token for a current server-issued session/profile. Server rejection, malformed cache or expiry returns to sign-in. Initial restoration has an eight-second connection budget. Normal token rotation updates the protected file. Sign-out clears it and attempts server token revocation; network failure does not prevent local sign-out. Temporary passwords requiring change are never remembered.

Use **نسيت كلمة المرور؟** on desktop sign-in or `/portal/forgot-password` for the company owner's registered portal email. Local employees continue to use administrator-assisted reset in PMS user administration. Email links open `/portal/reset-password#token=...`; the page removes the fragment after loading and does not automatically sign the user in after reset.

Opaque random 32-byte tokens expire after 30 minutes and only their SHA256 digests are stored. Customer-row locking prevents concurrent email bursts and reset races; reset consumes every outstanding link for that customer and increments the portal authentication version, ending old portal JWTs. Generic replies and a minimum response delay reduce account enumeration. SMTP failure is logged without tokens/addresses; failed-delivery records are removed so a new request can be made. This is direct asynchronous sending, not a durable mail outbox: if the backend stops before delivery, request another link after the cooldown.

After resetting, sign into PMS with the new password while internet is available. Existing portal-owner verification updates the local password hash and now revokes prior local refresh sessions on that verified change. Cloud reset cannot instantly revoke a disconnected local ERP session; the local API observes the new credential when the owner signs in online. Staff passwords, branch scope, licensing checks and offline grace were not weakened.

## Operator setup — required before real use

Set these through the backend's protected environment/secret configuration, never in source/client packages:

```text
SMTP_HOST=<approved SMTP host>
SMTP_PORT=587
SMTP_USER=<mailbox or SMTP user>
SMTP_PASSWORD=<SMTP credential; keep secret>
SMTP_FROM=PMS <approved-sender@example.com>
PORTAL_PUBLIC_URL=https://<approved-customer-portal-host>
```

Port 465 uses implicit TLS; port 587 requires STARTTLS. Certificate verification remains enabled. No email was sent to a real customer during development. Without configuration the endpoint returns service unavailable instead of claiming email delivery. Actual provider credentials, sender authorization and inbox delivery remain operator acceptance gates. Customer IP routes are throttled; each account also has a serialized one-minute email cooldown.

Prepare and approve a backup/deployment window, then apply `20261112000100_customer_password_recovery` to the intended issuer database through the normal migration process. It adds `customers.auth_version` and `customer_password_resets`. Generate Prisma client code and deploy the backend/frontend together, then distribute the updated desktop application. Existing customers default to version zero; older portal JWTs remain compatible until password reset. Production migration/deployment was not executed by this work.

Nodemailer is pinned at 10.5.0 with development types 8.0.2. A local generated-client attempt encountered an engine-file lock; isolated PostgreSQL acceptance therefore used a separately generated client without stopping the user's Node processes. Run normal Prisma generation during the approved build/deployment before starting the new backend.

## Verification and references

Evidence is retained in PMS `docs/licensing/remember-recovery-2026-11-12/`. Automated tests cover protected cache, opt-in, temporary-password exclusion, restart/rotation/logout, revoked tokens, SMTP TLS options with a mock transport, digest-only storage, expired/used links, portal JWT invalidation and a real disposable PostgreSQL race. No production connections or live email recipients were used. Actual email inbox delivery and an authenticated end-user install remain unverified until configured.

Implementation references: [Nodemailer SMTP transport](https://nodemailer.com/smtp), [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
