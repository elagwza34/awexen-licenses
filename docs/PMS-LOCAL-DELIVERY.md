# PMS ERP Local

Current installer: **1.4.2**, with [Awexen icons](PMS-BRANDING-1.4.2.md) and the [local login fix and password eye](PMS-LOGIN-1.4.1.md). [Shared pricing, customer checkout and plan limits](PMS-PLANS-AND-CHECKOUT.md) describes the deployed flow; older release sections below are historical snapshots.

## Customer workflow

1. Choose a monthly/yearly plan at `https://awexen.com/pms` and register through its button. The selected plan is saved automatically and the customer enters their portal.
2. Review the selected plan and initial setup fee, then send a payment request with its receipt. Existing accounts can sign in at `https://licenses.awexen.com/portal/login`.
3. The owner confirms the payment. The existing approval transaction creates the licence,
   links it to the customer and enables download. Repeating approval must not issue another licence.
4. The customer opens **Download** and installs **PMS ERP Local** on Windows x64.
   Setup requests Administrator access once to install the local database and API services.
5. Copy the licence from **Activation codes** and activate the desktop online.
6. Sign in with the **same email and password as the customer portal**. This first sign-in
   validates licence ownership online and creates the local business owner with Administrator permissions.
7. Products, reference data, staff, permissions, imports and audit records stay in the local database.
   Staff accounts are created locally; staff do not need individual portal registrations.

## Offline operation

The desktop verifies the response with the shipped public key, caches a signed, device-bound
offline lease using Windows DPAPI, and starts without HTTP before the next scheduled check.
The lease uses the licensing server's `validationIntervalHours` and `gracePeriodDays`; defaults
are 72 hours and 7 days. Both deadlines are capped at the licence's expiry.
At the due date, network failure may use the signed grace period. An explicit invalid/revoked
response blocks use immediately. At the offline deadline a connection is required. A minute timer
also enforces this while the app remains open, keeping unsaved forms in memory behind activation.
Ordinary clock rollback, changed payloads, deadlines and device identities are rejected.

Customer accounts marked SUSPENDED, INACTIVE or soft-deleted are rejected even when their licence
row is still ACTIVE. Reactivating the account does not silently change licence statuses.
Starting with desktop **1.1.1**, a lightweight online status check runs at startup, every minute,
and when Windows reports restored network availability. Restored Internet access without a
network-adapter event is detected at the next minute check. A definitive rejection clears the
cached permission and blocks the UI while preserving open forms. The status check is read-only:
it does not activate devices, write a validation-history row or renew the offline deadline.
Transport errors leave an authentic, unexpired offline lease usable. Full signed renewal still
occurs at the configured 72-hour deadline, with 7 days' network-failure grace. Explicit suspension
never receives grace. Versions 1.1.0 and earlier need a client update for the minute checks;
a disconnected device cannot discover a new suspension until it reaches the licensing server.

An enrolled owner's password is stored only as a salted hash. Correct saved credentials work
locally. A changed portal password is verified online when entered and updates the local hash.
The portal password is rechecked on its verification interval; changes on another device cannot
be learned while offline. Local change/reset-password endpoints refuse changes to the enrolled
owner's password, so a separate local owner password cannot silently replace the portal identity.

## Installed components and backups

- App: `C:\Program Files\PMS ERP Local` (separate from the earlier PMS ERP Desktop installation).
- Database: PostgreSQL 17, `127.0.0.1:55439`, database `pms_erp`, service `PmsErpDatabase`.
- API: `http://127.0.0.1:18501`, service `PmsErpApi`. Both services start with Windows.
- Protected data/configuration: `%ProgramData%\PMS ERP`. Credentials are generated on the customer's
  computer and never shipped in the installer. The business database is not the licensing database.
- Backups: `%ProgramData%\PMS ERP\backups`, before setup migrations and daily at 02:00 via
  **PMS ERP Local Backup**. A missed scheduled run starts when the machine becomes available.
  Backups are PostgreSQL custom archives validated by `pg_restore --list`. Existing backups are
  preserved; monitor free disk space and copy important backups to another protected disk.
- Manual backup, from elevated PowerShell:
  `& 'C:\Program Files\PMS ERP Local\setup\Backup-Local.ps1'`
- Setup log: `%ProgramData%\PMS ERP\setup.log`; failure details: `setup-error.log`.
- Uninstall removes the two new services and backup task, while preserving ProgramData and backups.
  Reinstall reuses database identity and never resets a cluster with missing recovery credentials.
- The older `erpsystem` database on port 5432 is preserved. This installer does not migrate old
  business records automatically; transferring existing business data requires a reviewed migration.

## Build and distribution

The UI uses native .NET WPF controls and light/dark resource palettes. DevExpress packages and
runtime files are removed. The unused QuestPDF dependency was also removed. No UI subscription
or separate .NET/PostgreSQL installation is needed by the customer.

Reproducible build source: `D:\PMS\deploy\LocalInstaller\Build-LocalInstaller.ps1`.
Use the Inno Setup 6.4.3 compiler (its licence permits commercial application installers), a
PostgreSQL 17 runtime and the existing public verification key. Never package signing private
keys, portal passwords, `.env`, the original database, or production deployment secrets.

The release is published only after local installer checks. The customer Download button first
calls the authenticated portal endpoint and then follows the returned HTTPS installer URL.
The installer contains no customer secrets; activation and account ownership grant use of the app.

This release delivers the existing product-management and administration modules plus the
customer delivery/licensing workflow. Domain contracts for future sales, purchases, accounting
and full financial reports are not claims that those modules have working desktop screens.

## Verified delivery state — 2026-11-05

- Installer uploaded: `https://licenses.awexen.com/downloads/PMS-ERP-Local-Setup-1.1.0.exe`.
- Actual size: 119,349,246 bytes. Full remote download matched local SHA-256:
  `cb7d38cefdb6646d98fdad54b721ce3a1f8597ad726c16c5f40f9abf9b0655f1`.
- API deployment `01a1ab7e-4d64-7303-8677-fcc507166d0c` completed successfully. It fixes JSON
  serialization of Prisma BigInt file sizes across admin releases and customer download responses.
- Website, portal sign-in and portal download SPA routes returned HTTP 200 with the updated bundle.
- Release ID 1 is **PUBLISHED** on the stable Windows channel. The public latest-release API
  reports version 1.1.0/build 1100 with the verified URL, size and checksum.
- Tests run: 209 .NET unit, 128 desktop (including native screen loading, licence/cache checks and
  dashboard permissions), 9 focused integration (owner identity/password and product sorting),
  and 12 licensing backend tests. The live production signature/activation and offline cache startup
  test also passed after the final API deployment.
- The final installer upgrade test succeeded after Windows Administrator approval. Both services
  are running with automatic startup, database recovery identity was unchanged, the scheduled
  backup task completed successfully, and the API became healthy after service restart.
  Installed desktop version is 1.1.0; no DevExpress or unused QuestPDF runtime remains in the
  installed application. Results are in `.diagnostics/final-install.result.json`, with the Inno
  setup log in `.diagnostics/final-install.log`. No Windows reboot was needed.
- A complete manual journey using a real customer's portal password has not been performed.
  Owner enrollment, ownership checks, password synchronization and offline behavior were covered
  by the focused integration/desktop tests; the live production activation/cache test passed.
- Before the last API deployment, the one payment receipt reference already returned 404. There
  was no existing receipt file to back up; customer/payment/licence database records were retained.
- Subsequent deployment `01a1ab92-4046-735a-8d99-571aa91711b9` completed successfully and adds
  account-level suspension enforcement to licence validation. Four regression cases cover
  suspended, inactive, deleted customers and unchanged independent licence revocation checks.

## Fast suspension update — 1.1.1

- Release ID 2/build 1101 is **PUBLISHED**, and 1.1.0 is deprecated. The earlier installer URL
  is retained; the new installer is `https://licenses.awexen.com/downloads/PMS-ERP-Local-Setup-1.1.1.exe`.
- Size: 119,351,303 bytes. SHA-256:
  `a787ab44df52743c3f4372a26583594cc5b3a488c2a43b422d17a3ae4de9a6cb`.
- Backend deployment `01a1ab9f-11d4-71a2-a9fd-bbe20daa447c` adds public, rate-limited
  `POST /api/v1/validations/status`. It checks account, licence, expiration and this device's status
  without activation, licence renewal or per-minute validation-history writes.
- Desktop checks status at startup, when Windows reports network availability, and every minute.
  Before the full-validation deadline, successful status checks and network failures preserve the
  original signed lease. Explicit rejection clears it. At the deadline normal full validation
  and the existing bounded offline fallback apply. No 72-hour or 7-day setting was changed.
- 132 desktop tests and 21 licensing backend tests passed, including early suspension, network
  recovery, unchanged lease deadlines, device denial, and offline grace. A separate live production
  heartbeat test returned a definitive rejection for the installed device without changing its cache.
- Upgrade to 1.1.1 installed successfully with the database identity preserved. Backup and service
  recovery verification succeeded (`.diagnostics/heartbeat-install.result.json`); an initial backup
  confirmation timeout was retried using the scheduler's own previous-run timestamp.
- The complete public download matched the local SHA-256; latest-release API reports 1.1.1.
  Existing customer computers must install this update for fast suspension behavior.

## Business modules — 1.2.0

- Completed the repository's business navigation: branches/warehouses, stock opening and
  adjustment/damage/transfers, suppliers/customers/settlements, purchase approval and partial
  receipt/returns, sales drafts/POS/split tender/credit/collections/refunds/voids,
  employees/user linkage/attendance, dashboard and reports with Excel and native Windows printing.
- No DevExpress or paid PDF runtime. PDF output uses Microsoft Print to PDF. Actual printer
  hardware and native file-picker interactions remain manual checks.
- IDs are explicitly application-generated, so new child rows in edited documents/role graphs
  insert correctly. Version tokens protect all entities; duplicate stock/default/open-attendance
  constraints protect races. Idempotency receipts protect new financial/stock operations.
- JWT validation checks current account status/password stamp and role grants on each request.
  Temporary staff passwords must be changed before business routes can be used. Password changes
  also revoke refresh sessions. Owner portal identity and licence/offline policies are preserved.
- Final automated results: **209 unit + 133 desktop + 13 integration = 355 passed**.
  PostgreSQL tests use disposable databases and cover reconciliation, legacy upgrade, partial
  purchases, draft editing, split credit sale, collections, full/partial return, void,
  stock movement/concurrency, attendance, report/export and HTTP access revocation.
- Both schema migrations are packaged. Legacy customer/supplier balances and completed sales
  are carried forward without resetting them. Conflicting duplicate stock/default/attendance
  data or ambiguous legacy partial returns stop the migration for reconciliation.
- Local upgrade to 1.2.0 passed: database recovery identity and all business table record counts
  were preserved, backup task succeeded and local API recovered after service restart.
  Evidence: `.diagnostics/operations-install.result.json`.
- Installer size: **119,491,850 bytes**. SHA-256:
  `f3db08ae59fdf80ea8f78488b75f044585e554f6028773914ba96e2c8b1c8ddb`.
- This is the operational PMS scope, not a payroll engine or statutory accounting general ledger.
  Inventory valuation is current; top-product reports for invoices in a date range reflect all
  their returns up to the report run. Profit is gross merchandise margin, not net business profit.
- Arabic operating guide: `PMS-1.2-USER-GUIDE.ar.md`.
- Release ID **3**, build **1200**, is **PUBLISHED**. The latest-release endpoint returns 1.2.0;
  1.1.1 is deprecated and its original URL remains usable. The full public 1.2.0 download
  matched the SHA-256 above and all three portal pages and their JavaScript assets returned 200.
- Previous 1.1.0/1.1.1 executable URLs had fallen back to SPA HTML and were restored from
  their original local artifacts. Uploads exposed partial files while in progress; targeted
  Cloudflare cache purges removed those incomplete cached responses. Before future front-end
  deployments, preserve the download directory, and verify completed artifacts before publishing
  or requesting their public URLs. This release did not overwrite the frontend application.
