# PMS completion work

Requested order: implement the missing system modules first; run functional tests after implementation.
Build checks during implementation are allowed. Do not deploy unfinished modules or run migrations
against existing customer databases during development. Preserve existing data and source changes.

Implementation scope from the repository navigation/domain:

- [ ] Branches and warehouse administration, including active/default guards.
- [ ] Stock balances, opening balances, movements, adjustments, damage and transfers.
- [ ] Suppliers and business customers, balances and settlement history.
- [ ] Purchase order editing, submission, approval, partial/full receiving and cancellation.
- [ ] Sales and POS, draft editing, checkout, split payment/credit, stock issue, returns/voids.
- [ ] Employees, user linkage and attendance.
- [ ] Date-filtered sales/purchases/profit/inventory/tax/partner reports and export/printing.
- [ ] Desktop navigation, Arabic forms, permission checks and error/loading states for all modules.
- [ ] Schema migrations, clean install/update packaging and operating documentation.
- [ ] Final functional/security/transaction/concurrency and desktop test stage.

Licensing 1.1.1 behavior remains intact: minute online suspension checks; 72-hour signed renewal
and the existing offline grace are independent. Business data stays on the customer machine.
