# Monthly and yearly subscriptions

Implemented on 2026-11-17. Administrators configure interval prices in Plans. Blank prices fall back only to a matching legacy interval; zero disables that interval. Do not infer annual pricing from monthly pricing.

Customers select a plan, interval, and existing subscription where applicable. Quotes last 15 minutes. Same-interval upgrades preserve expiry and deduct unused paid service. Changing interval starts the displayed new term and deducts unused credit. Renewals preserve previously purchased future periods. A bank-transfer receipt creates a pending payment; approval applies the subscription and signed license atomically. Existing license keys and device links remain in use. All plans share one PMS installer.

The server rejects stale quotes, changed entitlements, forged amounts, duplicate approvals, and conflicting use of unused credit. Signing failures roll back approval. Active downgrades, negative balances requiring refunds, lifetime terms, unrestricted legacy plans, unlinked old licenses, and ambiguous legacy prepaid histories require administrative review. Generic refunds cannot reverse quoted payments without a reviewed service settlement.

## Deployment

Apply reviewed additive migrations after an access-restricted PostgreSQL backup. This release includes server-device metadata, customer password recovery, and plan billing quotes. Deploy the generated Prisma client, API, and frontend together. Preserve the existing production signing key and every environment variable. SMTP credentials remain required before password recovery can deliver real email.

Uploaded bank receipts are runtime data. Back them up through authenticated receipt reads before replacing a Node.js build. The optional `.release-receipts.enc.json` recovery envelope uses AES-256-GCM and an RSA-OAEP-wrapped key encrypted to the existing issuer public key. Startup restores exact receipt bytes, rejects conflicts or invalid filenames, and removes the envelope. Never commit receipts, recovery envelopes, database dumps, or secrets. The recovery helper is covered by synthetic tampering, traversal, and conflict tests.

Local verification: 59 backend tests, two real isolated PostgreSQL acceptance tests, API production build, frontend production build, and mocked browser checkout/admin flows. Real payment collection and customer email delivery were not tested. Publication evidence is maintained in the PMS repository under `docs/licensing/release-1.4.11-2026-11-17/`.
