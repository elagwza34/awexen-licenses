# PMS Public Plan Parity Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task in the current clean checkouts.

**Goal:** Match public PMS pricing, resource limits and checkout selection to the licensing catalogue.

**Architecture:** Keep the licensing public catalogue authoritative for prices, billing intervals, features and limits. The marketing frontend projects this data into cards, comparison and resource-based plan selection. Registration carries a validated plan key and billing interval into the corresponding system checkout. Existing signed entitlements enforce resource limits in PMS.

**Tech Stack:** React/Vite/TypeScript, NestJS/Prisma/PostgreSQL, .NET 8/WPF.

**Spec:** User request in this session: remove the PMS quote CTA; 15% annual discount; starter one user; growth two branches/two warehouses/four devices; advanced five branches/five warehouses/ten devices; remove the chains wording; add resource selectors, monthly-equivalent summary and matching comparisons. WooCommerce for growth/advanced and shipping for advanced require a clarified service/integration scope before advertising working connectors.

## Global Constraints

- Preserve current monthly prices and one-time setup fees.
- Annual amounts come from billingOptions and retain exact minor-unit totals.
- No fake `_YEARLY` plan keys, arbitrary add-on prices or checkout entitlement overrides.
- Preserve account/license/payment history and issuer keys.
- No unsupported WooCommerce/shipping feature keys may be sold as working PMS capabilities.
- Keep educational-site code outside PMS; misr-edu maintenance is separate.

## Review Focus

- Annual billing unavailable: never fabricate an annual checkout or price.
- Registration/login must preserve selection without accepting external redirect URLs.
- Builder requirements exceeding a base tier must select an eligible plan or explain unavailability.
- Plan limit edits must propagate device limits and invalidate old entitlement leases safely.
- Existing customers above reduced limits must not be silently enrolled into an unusable plan.

## Tasks

- [x] Marketing: write failing pure contract tests, implement authoritative pricing/URLs/resource matching, then update cards, comparison, builder and copy. Verify fixtures, mobile RTL and production build.
- [x] Portal: write failing selection tests, carry validated plan/interval through registration and login to system checkout, then verify monthly/yearly and invalid inputs.
- [x] Policy: update presets and validate signed runtime enforcement with regressions for one user, two branches/two warehouses, and device-limit propagation.
- [x] Integrations: user confirmed human setup services. Add separate catalogue/admin metadata and truthful service descriptions; no carrier connector is implemented or advertised as working.
- [x] Verify changes across all affected repositories, document validation and outstanding release work. No PMS publication or production migration performed.

## Decisions and handoff

The resource selector maps requirements to fixed published plans rather than inventing custom unit prices. Existing devices with explicit device-seat overrides keep them during the migration. Production preflight found active licenses; reduced-capacity rollout requires reviewing existing installations before applying it. Implementation evidence and release instructions are in `docs/portal-systems/2026-11-18/PMS_PLAN_PARITY.md`.
