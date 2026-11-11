# PMS completion work

Current release: **1.4.2**, with [Awexen icons and branding](PMS-BRANDING-1.4.2.md). See [login fix](PMS-LOGIN-1.4.1.md) and [plans and checkout delivery](PMS-PLANS-AND-CHECKOUT.md) for the shared public catalogue, automatic registration selection, signed plan enforcement and verification results. Earlier release entries below are historical snapshots.

Requested order: implement the missing system modules first; run functional tests after implementation.
Build checks during implementation are allowed. Do not deploy unfinished modules or run migrations
against existing customer databases during development. Preserve existing data and source changes.

Implementation scope from the repository navigation/domain:

- [x] Branches and warehouse administration, including active/default guards.
- [x] Stock balances, opening balances, movements, adjustments, damage and transfers.
- [x] Suppliers and business customers, balances and settlement history.
- [x] Purchase order editing, submission, approval, partial/full receiving and cancellation.
- [x] Sales and POS, draft editing, checkout, split payment/credit, stock issue, returns/voids.
- [x] Employees, user linkage and attendance.
- [x] Date-filtered sales/purchases/profit/inventory/tax/partner reports and export/printing.
- [x] Desktop navigation, Arabic forms, permission checks and error/loading states for all modules.
- [x] Schema migrations, clean install/update packaging and operating documentation.
- [x] Final functional/security/transaction/concurrency and desktop test stage.

Licensing 1.1.1 behavior remains intact: minute online suspension checks; 72-hour signed renewal
and the existing offline grace are independent. Business data stays on the customer machine.

Final verification so far: 209 unit tests, 133 desktop tests (including every new WPF view),
13 integration tests. Real PostgreSQL tests create isolated uniquely named databases and cover
partial purchasing, sale drafts/edit/checkout, split credit/card/cash, collections, refunds,
voids, supplier returns, inventory transfer/adjustment, attendance, Excel exports, reconciliation,
optimistic concurrency, HTTP permission/status/password revocation and legacy schema upgrade.

No paid UI/report runtime was added. PDF uses the native Windows print dialog. This release
implements the repository's business modules; payroll calculation, statutory accounting,
multi-currency conversion and an accounting general ledger are not part of these modules.
