# PMS 1.4.1: local sign-in and password visibility

The desktop API client previously called the licence-header attachment twice on the same HTTP request. The resulting repeated `X-PMS-Lease` value was not a valid single Base64 document, so the local API rejected the request before checking the owner's email and password.

Version 1.4.1 attaches the licence headers once and makes the attachment idempotent. It preserves the signed lease checks and the existing local owner identity; no password reset, licence bypass or database reset is used.

The login password field now has an eye button physically on its right. Revealed edits update the same password value, hiding clears the separate plaintext control, and losing window activation masks it again.

Validation:

- All 135 desktop tests passed, including a transport regression that checks each signed header occurs once and WPF show/edit/hide checks.
- The corrected desktop client reached credential validation on the running local API with the existing signed lease and a random nonexistent username. No real customer's password was needed or changed.
- The rendered WPF screen was inspected to confirm the eye is inside the password field on the right.
- Local installation checks confirmed version 1.4.1, preserved database identity and business-record counts, automatic services, recovery and the backup task.

Installer: `PMS-ERP-Local-Setup-1.4.1.exe`, 119,744,207 bytes, SHA-256 `ae82449b124215558842ce11b65520c2c1b57b10e3131dd4a8463fe14072f6ee`.

Owners sign in with the email and password of the customer licence portal. Staff retain their local usernames. The owner's actual sign-in should be retried after this update; the transport probe verifies the request path, not knowledge of a customer's password.
