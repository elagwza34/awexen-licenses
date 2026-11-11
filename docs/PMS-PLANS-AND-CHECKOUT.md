# PMS plans and automatic customer registration

Deployed 6 November 2026 on `awexen.com/pms`, `licenses.awexen.com` and the existing licensing API.

Latest desktop patch: **1.4.2**, with [Awexen branding](PMS-BRANDING-1.4.2.md) and the [login transport fix and password eye](PMS-LOGIN-1.4.1.md). The 1.4.0 rollout and installer checks below document the original plan-enforcement release.

The public page and customer portal read the same database catalogue from `GET /api/v1/portal/public-catalogue` and its authenticated counterpart. Prices are stored as integer piastres. The existing legacy plans and licences keep their previous prices and rights.

| Plan | Monthly EGP | Annual total EGP | Initial setup EGP | Active users | Branches | Warehouses | Devices |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter / الأساسية | 1,500 | 14,400 | 3,000 | 2 | 1 | 1 | 1 |
| Growth / النمو | 3,500 | 33,600 | 5,000 | 5 | 1 | 3 | 1 |
| Scale / المتقدمة | 6,500 | 62,400 | 8,000 | 20 | 5 | 20 | 3 |

Annual totals correspond to 1,200 / 2,800 / 5,200 EGP per month, paid yearly. The initial payment includes the setup fee. Existing customers whose download access was already approved are not charged initial setup again by the portal. Payments remain manual bank transfers with receipt review; registration does not mark anything paid or issue a licence.

## Customer flow

1. The public pricing button opens `/portal/register?plan=PMS_STARTER`, `PMS_PRO`, or `PMS_BUSINESS`. Yearly choices append `_YEARLY`.
2. Registration shows the server's current price and setup fee. The backend validates the active, priced, enforced plan key and stores `customers.requested_plan_id`; URL prices are never trusted.
3. Registration signs the customer into their portal and opens the subscription page with that plan selected. The selection remains in the database across later logins and is visible in the owner's customer details.
4. The customer submits a receipt. The server validates the amount and any subscription's ownership, and stores the exact `payments.plan_id`. Approval uses that stored identity, including when several plans share a price.
5. The owner reviews the payment and approves activation. Existing approval logic enables downloading and issues the selected plan's licence. The customer's request history names the selected plan.
6. The customer downloads PMS 1.4.0, activates once online and runs their business locally. Signed offline leases enforce the selected features and installation limits. Existing offline verification policy remains in place.

## Editing

Edit recurring prices, initial setup fees, capabilities and resource limits in the owner's Plans screen. Public pricing and feature comparison then read the updated catalogue. Monthly and yearly billing options are separate plan records; edit the relevant interval. No public website rebuild is needed for price, fee, limit or feature changes.

The public site's source is `D:/Projects-code/awexen code/awexen-site/frontend`, principally `src/hooks/usePmsCatalogue.ts`, `src/pages/PMS.tsx`, and `src/components/PMSSection.tsx`. The public site's original Git deployment remains configured. Source changes are saved locally and have not been committed or pushed.

Custom integrations and add-ons are not silently included in these desktop plans. The detailed comparison lists the features actually configured for each licence. Limits apply to each local installation/database, and device slots are separate from user accounts.

## Validation

- Backend typecheck and 28 tests passed, including selection persistence, unavailable plans, amount tampering and exact plan resolution.
- Both frontend builds and TypeScript checks passed.
- Both migrations passed against an isolated database initialized from the real Prisma baseline, preserving the existing plan.
- Production smoke test registered a temporary customer on Growth yearly, verified selection after login and identical catalogues, and confirmed downloads remained gated. The temporary account was removed.
- Headless Chrome rendered the live monthly pricing links and selected annual registration price plus setup fee.
- PMS 1.4.0 installer was downloaded in full and verified: 119,513,490 bytes; SHA-256 `bea12df4091d6ef34b569859494fe148afcc62e9b4ba068efb17544b3367a212`. It is published as the stable customer release.
- Local 1.4.0 installation preserved database identity and business-record counts; API/database services, recovery and scheduled backup checks passed.
