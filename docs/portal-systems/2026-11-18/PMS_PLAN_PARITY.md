# PMS plan parity — implementation and validation

## Result

The Awexen PMS page uses licensing catalogue `billingOptions`, limits, runtime features and `includedServices` for its cards and comparison. Annual billing is twelve monthly payments less 15%, with the one-time setup fee separate. Exact period totals come from the API; monthly equivalents are display values. Missing annual pricing does not produce a fabricated annual plan or checkout.

| Current tier | Users | Branches | Warehouses | Devices | Included setup services |
| --- | ---: | ---: | ---: | ---: | --- |
| Starter / الأساسية | 1 | 1 | 1 | 1 | None |
| Growth / النمو | 5 | 2 | 2 | 4 | WooCommerce |
| Advanced / المتقدمة | 20 | 5 | 5 | 10 | WooCommerce and shipping companies |

Setup services are human-coordinated work after subscription, as confirmed by the user. They are not WooCommerce/shipping runtime feature flags or a claim that connectors already exist. Administrators edit them separately from desktop capabilities. Public descriptions stop promising a service when it is removed from the catalogue.

Resource selectors recommend the least expensive fixed plan that supports the requested branches, warehouses and devices. The buyer receives that plan's full published limits. No per-resource prices or entitlement overrides are invented. The summary labels the monthly equivalent as monthly and shows the exact annual total and separate setup cost. PMS quote CTAs and the erroneous chains wording are removed.

Registration preserves the real plan key and billing interval into `/portal/subscription/:systemKey`. Existing-account login preserves the same choice and waits for catalogue validation before allowing that transition. Invalid or unavailable choices cannot silently become another purchase. User choices are not overwritten by background catalogue refetches.

## Database and installed PMS

Migration `20261117000300_pms_plan_catalogue_parity` adds the setup-service array, changes only the three canonical PMS tiers, and gives Growth `MULTI_BRANCH`. It preserves prices, fees, keys, dates, subscription records and payments. Affected license versions increment; inherited device limits follow their tier while explicit per-license device overrides remain intact. Existing archived annual-plan records remain historical.

PMS already enforces user/branch/warehouse limits from RSA-signed entitlements. Its regression now explicitly proves that the owner consumes Starter's single active-user seat and a second user is rejected. Runtime code and installer version are unchanged.

## Validation

- 69 licensing backend unit/contract tests pass; backend and portal production builds pass.
- Four pure marketing tests pass; marketing TypeScript check and production build pass.
- Three real PostgreSQL tests run in separate disposable databases: migration preservation/overrides, paid billing lifecycle, and settings/history retention.
- The PMS signed-entitlement integration test passes against an isolated PostgreSQL cluster.
- Nine synthetic browser scenarios pass: all three plans with both billing intervals, existing-account login with delayed catalogue, invalid interval, and removed-service promises. Also covers resource selection, 15% amounts, mobile overflow and desktop rendering. Browser APIs are intercepted; no real account or payment is created.
- Independent code review found and rechecked fixes for delayed-catalogue navigation and stale service copy. No important issue remained in the recheck.

## Release state

**Implemented locally; these PMS changes are not published and the production migration is not applied.** A read-only preflight found one active license on each canonical tier. Before release, review reduced user/warehouse capacity with those installations: existing PMS permits remediation and reads but blocks ordinary writes while active records exceed a signed limit. Offline devices receive updated terms on issuer refresh and keep existing leases until their deadlines.

Release requires database backup, migration before the new API, then both frontends. Preserve signing keys and hosted receipts/installers. Licensing frontend Git auto-deployment must stay disabled; use partial frontend publication, with `index.html` last, to avoid deleting downloads. Recheck live plan data, checkout selection and existing installer links after publication.

## Reproduce

Licensing backend: `npm test`, `npm run build`, and `powershell -ExecutionPolicy Bypass -File scripts/test-pms-catalogue-postgres.ps1` (PostgreSQL 17 by default). Portal frontend: `npm run build`.

Marketing frontend: `node --experimental-strip-types scripts/test-pms-catalogue.mjs`, `npx tsc --noEmit`, and `npm run build`. Run `scripts/test-pms-checkout.cjs` with Playwright available, marketing on port 4182 and portal on 4180. `PLAYWRIGHT_MODULE`, `CHROME_PATH`, `PMS_MARKETING_ORIGIN`, `PMS_PORTAL_ORIGIN`, and `PMS_CHECKOUT_OUTPUT` configure the runner without project-specific machine paths.
