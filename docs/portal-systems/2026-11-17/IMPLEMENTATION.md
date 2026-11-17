# Customer systems and annual pricing

Implemented, verified, committed, and subsequently deployed on 2026-11-17 after the owner's authorization. See [publication evidence](PUBLICATION.md) for the live rollout. The implementation-phase verification below remains historical evidence.

## Customer experience

The customer navigation now separates **الأنظمة والاشتراكات** from **اشتراكاتي**. The catalogue starts with one administrator-managed PMS system tile named **نظام إدارة المنتجات**. Selecting it opens its plans with accessible monthly/yearly tabs. There are no placeholder systems. Active systems added through the administration page appear in the catalogue; systems without saleable plans display an empty state.

My Subscriptions shows each owned subscription's system, plan, interval, contracted amount, start/end dates, and status. Keys are masked until explicitly revealed. Full keys still come from the existing authenticated customer endpoint. Downloads use the selected subscription's plan key and the existing server-side ownership/payment/license gate. Renewal links bind the owned subscription explicitly; catalogue purchases default to a new independent subscription. Legacy unlinked keys remain accessible through their existing page.

## Approved pricing rule

Annual service is twelve monthly payments less **15%**. Calculation uses integer minor units and rounds once to the nearest minor unit, half up. Setup fees are separate and are not discounted.

Based on the current published monthly prices and setup fees, amounts in EGP are:

| Plan | Monthly | Annual service | One-time setup | First annual purchase |
| --- | ---: | ---: | ---: | ---: |
| Basic / الأساسية | 1,500 | 15,300 | 3,000 | 18,300 |
| Growth / النمو | 3,500 | 35,700 | 5,000 | 40,700 |
| Advanced / المتقدمة | 6,500 | 66,300 | 8,000 | 74,300 |

The annual quote, catalogue, administrator listing, and read-only editor preview use the same rule. Editing the monthly price recalculates annual pricing. Legacy annual-only plans retain their configured price when no monthly price exists.

Setup is not repeated for renewals or upgrades. Paid history is scoped to the software system. A manually unlocked legacy PMS customer without evidence of another system retains the previous waiver behavior. If setup is paid through another purchase after a quote is created, submission or approval rejects the stale setup charge and requires a fresh quote. Historical subscription prices, existing paid periods, and previously frozen PMS quote hashes remain unchanged.

## Data and administrative controls

Additive migration: `20261117000200_software_systems_annual_discount`. It creates `software_systems`, seeds PMS, and associates existing plans with PMS through a restricted foreign key. It does not rewrite historical financial rows or backfill annual contract prices. It was subsequently applied during the authorized publication.

The administrative Systems page uses existing plan-view/create/update permissions. Systems are hidden rather than deleted, preserving existing customer subscriptions. Plan creation selects a system; existing plans cannot move between systems. Active-system checks guard checkout. Other systems cannot inherit the global PMS stable installer channel; their installers require the existing plan-specific release configuration. Registering a system alone does not implement another application's feature enforcement or installer.

The authorized rollout applied the migration and API before publishing the frontend. Future deployments must retain the existing issuer signing key, runtime receipts, and manually uploaded installers. Frontend Git auto-deployment remains disabled under the established deployment policy. No new desktop installer is needed for these portal changes.

## Verification

- Backend: **64 passed**, zero failures or skips; production API build passed.
- Isolated PostgreSQL: **3 passed**, including real signing/approval races, recovery, system isolation, masked owned keys, the annual formula, first setup per system, and stale setup-charge rejection at submission and approval. The disposable database was dropped and its server stopped.
- Frontend production build passed. Browser fixtures passed for the single initial system tile, annual quote submission, 390px mobile layout, key reveal/hide, plan-scoped download navigation, owned renewal, administrative system creation, and read-only annual preview. Production requests were blocked during browser testing.

Implementation-phase evidence and source hashes: `VERIFICATION.json` and `SOURCE_MANIFEST.json`. Raw logs and screenshots remain under `D:/PMS/artifacts/portal-systems-*`. No live customer purchase or payment approval was performed. Production migration and deployment are recorded separately in `PUBLICATION.json`.
