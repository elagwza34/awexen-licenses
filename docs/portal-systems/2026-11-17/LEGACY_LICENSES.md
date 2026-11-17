# Legacy licenses in My Subscriptions

An existing customer can have a valid license created before subscription records were introduced. Previously, My Subscriptions showed an empty-account message and a separate legacy-code warning. It now displays these licenses alongside subscriptions, including their actual status, trial flag, original dates, activation code and download link.

The page reads the existing owner-scoped overview and subscription endpoints. Licenses already included in a subscription are excluded from legacy cards. Loading failures have an explicit retry action; they do not produce a false empty state. No subscription, payment, license or database schema is changed.

## Validation

- Confirmed the misleading empty-account message with a failing browser regression before the fix.
- Five synthetic browser cases pass: ordinary legacy license, trial, mixed linked/unlinked licenses, truly empty account, and overview failure with retry.
- Mobile width 390px: no horizontal overflow; key reveal/hide works; no business mutations occur.
- Frontend TypeScript and production build pass.

## Reproduce

Run the frontend on port 4180. Install Playwright in a test tools directory and set `PLAYWRIGHT_MODULE` to its module path, or make it available through Node resolution. Set `CHROME_PATH` only when using an installed Chrome instead of Playwright's browser. Then run `node frontend/tests/legacy-subscriptions.cjs` from the repository root.

`LEGACY_PORTAL_ORIGIN` selects a local or hosted frontend; `LEGACY_PORTAL_OUTPUT` selects the evidence directory. All API responses are intercepted synthetic fixtures, including authentication. The hosted check verifies deployed UI assets and does not sign into or mutate a real customer account.

## Publication

Published source commit `cd6bf3a` to `https://licenses.awexen.com` on 2026-11-17. Uploaded only the changed JavaScript asset and then `index.html`; verified hosted asset bytes and SPA build references. No API deployment, migration or license mutation was performed. Git auto-deployment remains disabled to preserve hosted downloads.

All five browser cases also pass against the hosted frontend with synthetic API responses. A separate read-only production comparison confirmed that all selected account, license, subscription and payment metadata remained unchanged. All five existing installer links retain their expected sizes. Private account inspection evidence stays outside version control.
