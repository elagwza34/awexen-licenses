# PMS catalogue publication — 2026-11-18

Published to `https://awexen.com/pms`, `https://licenses.awexen.com` and `https://api.awexen.com` following the user's explicit request.

## Deployed sources

- Licensing source: `71b463e` — catalogue limits, setup-service metadata, selected-plan checkout and migration.
- Marketing source: `a097a70` — authoritative pricing, 15% annual discount, comparisons, resource selection, service copy and removal of PMS quote CTAs.
- PMS regression: `a5922f5a` — confirms that Starter's owner consumes its single user seat. Runtime remains installer **1.4.11 / 1411**; no new installer was needed or published.
- Hostinger API build: `01a1ebbf-bbbc-70ee-9c73-bd68566982b0`, completed successfully.

## Data and files

A new restricted-access PostgreSQL custom dump was created and its archive list verified before applying `20261117000300_pms_plan_catalogue_parity`. The migration completed successfully. Read-only comparisons before and after deployment confirmed unchanged prices, payments, subscriptions, license keys, dates and statuses. License versions and inherited device limits changed as specified; explicit per-license device overrides remain intact.

Available payment receipts were backed up, encrypted for the existing issuer key, restored at API startup and verified byte-for-byte. A historically missing receipt remains unchanged. The issuer public key is unchanged. All five existing installer links retain their expected sizes; latest stable stays 1.4.11 / 1411.

Both frontends were published by uploading changed assets and then `index.html`. Old assets, routing files, downloads and other hosted files were retained. Hosted asset SHA-256 values and SPA build references were checked.

Licensing frontend Hostinger auto-deployment remains disabled. Marketing's Hostinger Git auto-deployment was stopped for controlled partial publication; its prior settings were saved privately. The marketing commit uses `[skip ci]` so the separate GitHub Actions workflow does not perform an unrelated Supabase migration/Edge Function rollout or replace the entire website root. No Supabase schema or function was changed in this release.

## Live validation

- The real public catalogue exposes limits **1/1/1/1**, **5/2/2/4**, **20/5/5/10** for users/branches/warehouses/devices.
- Growth includes WooCommerce setup; Advanced includes WooCommerce and shipping-company setup. These remain human-coordinated services.
- A live browser using the real catalogue verified annual monthly equivalents **1,275 / 2,975 / 5,525 EGP**, resource selection, setup-service descriptions and the selected Growth yearly registration page. It submitted no registration.
- Nine browser scenarios also pass against deployed frontend assets using intercepted synthetic APIs: all three tiers with monthly/yearly registration, delayed-catalogue existing-account login, invalid interval blocking, and removal of stale service promises. No real customer or payment was created.
- Mobile 390px: no horizontal page overflow. Browser reports no page errors.
- Pre-publication checks remain green: 69 licensing tests, four marketing contract tests, three isolated PostgreSQL tests, the PMS signed-entitlement integration test, and frontend/backend builds.

The publication record in `PUBLICATION.json` contains the public deployment metadata. Backups, database credentials, access tokens, receipt contents and private inspection evidence remain outside version control.
