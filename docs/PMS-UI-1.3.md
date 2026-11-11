# PMS UI 1.3

The desktop uses a native WPF design system with no paid UI packages or remote font/image dependency.

- Navy navigation, teal accent, neutral surfaces, rounded cards and consistent spacing.
- Navigation stays on the right. Every row uses an explicit left-to-right grid for physical
  placement: the label is in column 0 and the icon in column 1. Arabic labels retain RTL reading.
- Light and dark palettes cover the shell, tables, fields, password boxes and editable/selectable
  combo boxes. Keyboard focus, validation, selection and disabled states remain visible.
- Dashboard uses actual API metrics and permission-filtered shortcuts. No fabricated trends or
  percentages were added. Business figures display decimal precision.
- Sign-in and activation were redesigned; existing field names, commands and authentication
  handlers are retained. No change to identity, licence enforcement or offline deadlines.
- The temporary-password window has additional height and vertical scrolling so the larger
  shared fields and validation messages cannot hide its Save button.
- Master-data and inventory editors use rounded panels; shared grid/input/button styles apply
  across business and administration modules. Data-grid virtualization is retained.

Verification: 133 desktop tests passed, including native rendering of every view, light/dark
theme switching, and a geometric assertion that sidebar icons are physically right of labels.
Screenshots generated from actual WPF controls are in `.diagnostics/ui-preview` in the licensing
workspace. Their zero-value dashboard data is an isolated visual fixture, not a customer dataset.

This is a desktop visual update; database schema and API business logic are unchanged from 1.2.
The final 1.3.0 installer was installed locally; business record counts and database recovery
identity were preserved, scheduled backup succeeded and API recovery passed. The installed
desktop DLL matches the final packaged DLL. Installer: 119,509,274 bytes, SHA-256
`43ca53cb9e374d2551fc8182265f450c1549652cb5a99d30ba6a5e7f0e29d0be`.

**Web publication is pending.** Hostinger upload attempts failed with connection resets and
403/404 responses. Release 1.2.0 remains published; no 1.3.0 release was published or advertised.
The local installer is available in the licensing workspace under
`.diagnostics/artifacts/PMS-ERP-Local-Setup-1.3.0.exe`. Evidence:
`.diagnostics/ui-install.result.json`, `.diagnostics/ui-local-delivery.json` and
`.diagnostics/pms-work/tests/ERPSystem.DesktopTests/TestResults/ui-desktop.trx`.
