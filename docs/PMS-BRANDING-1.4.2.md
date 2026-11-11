# PMS 1.4.2: Awexen branding

Uses the supplied `fav--icon.png` unchanged as the brand artwork. The Windows ICO contains 16, 24, 32, 48, 64, 128 and 256 pixel frames generated from that image.

- The desktop executable embeds `Assets/Awexen.ico` as its native application icon.
- Login, activation and the main shell explicitly use the embedded WPF icon; other windows also inherit the branded native executable icon.
- The sidebar header and login branding use the original Awexen PNG in place of the stock cube.
- Desktop and Start menu shortcuts explicitly reference the installed ICO.
- Inno Setup embeds the same icon in the 1.4.2 installer. The uninstall entry uses the branded application executable.

The ICO is both a WPF resource and a published content asset, so shortcuts work outside the application. The original PNG is embedded and does not require a runtime network request.

Validation: desktop Release build succeeded; native WPF screen-loading and password visibility checks passed; light/dark dashboard and login renders were inspected. Existing licence enforcement and customer database behaviour are retained.

Published older installers are immutable; the new branded download is `PMS-ERP-Local-Setup-1.4.2.exe`.

Installer: 120,045,436 bytes; SHA-256 `95ab319a04a1a0a8c4bc384a40db7912fee6d6d15a71733096ef7b796b053df1`. Native icons extracted from both the application and installer were inspected. The installed desktop shortcut references `desktop/Assets/Awexen.ico` explicitly.
