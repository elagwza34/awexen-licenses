# Customer portal publication — 2026-11-17

Published to [licenses.awexen.com](https://licenses.awexen.com/portal/subscription) from source commit `49857c12c90100e30c8d9963b28a3efccb90bb7e`.

- The customer catalogue is named **الأنظمة والاشتراكات**, initially showing only **نظام إدارة المنتجات**. Monthly/yearly selection appears above its plans.
- **اشتراكاتي** contains owned subscriptions, masked activation keys, renewal links, and plan-scoped downloads.
- Annual service uses twelve monthly payments less 15%. One-time setup remains separate: first annual totals are EGP **18,300**, **40,700**, and **74,300** for Basic, Growth, and Advanced respectively. Annual service without setup is **15,300**, **35,700**, and **66,300**.
- Migration `20261117000200_software_systems_annual_discount` was applied after a fresh access-restricted PostgreSQL backup. Historical financial rows were not rewritten by the migration.

Hostinger API build `01a1ea34-057c-73a1-853c-c20b9d2b0698` completed. The existing issuer public key was retained. Five receipt images were verified against their backup hashes; all six receipt references remained unchanged. One reference was already missing before this rollout.

The frontend was published by replacing only its changed CSS, JavaScript, and HTML files. Existing assets, routing configuration, and the downloads directory were retained. All five installer links, from 1.4.7 through 1.4.11, still return Windows executable bytes with their expected complete file sizes. This rollout did not rebuild or republish a desktop installer. Frontend Git auto-deployment remains disabled.

Verification includes 64 backend tests, successful production API/frontend builds, matching hosted asset hashes and deep links, authenticated read-only administrator API checks, and browser checks against the published administrator screens. Hosted customer screens were checked using synthetic session/subscription fixtures and the real public plan catalogue. No real customer purchase, payment approval, or customer credential was used. The earlier three isolated PostgreSQL acceptance tests remain recorded in `VERIFICATION.json`.

Detailed deployment evidence is in [PUBLICATION.json](PUBLICATION.json). Database dumps and receipt images remain outside Git in the access-restricted recovery directory. Raw deployment logs and browser screenshots remain in ignored PMS artifacts.
