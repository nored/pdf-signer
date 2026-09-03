# PDF Signer

Click-to-place digital PDF signer that runs entirely on your machine. Multiple named identities, per-placement appearance (text / image / both), lock or void-on-change, verify existing signatures.

Three flavors, same UI, same signing code:

| | Where | Install | Runtime |
|---|---|---|---|
| **Web** | `web/index.html` | none — open the file | any modern browser |
| **Tauri** | `tauri/` | Rust + webkit2gtk-4.1 (Linux) / WebKit (macOS) / WebView2 (Win) | ~10 MB native binary |
| **Electron** | `electron/` | Node + Electron | ~200 MB per platform |

## Web (zero install, most portable)

Open **`web/index.html`** in any browser. Loads pdf.js / pdf-lib / node-forge from cdnjs on first use, then browser cache. All data is local (IndexedDB).

## Tauri (recommended for desktop)

```sh
cd tauri
npm install          # tauri CLI + JS deps
npm run dev          # runs a dev window
npm run build        # bundles a .deb + AppImage on Linux; a .dmg on Mac
```

Requires:
- Rust (`rustup`).
- Linux: `webkit2gtk-4.1`, `pkg-config`, `libssl`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
- macOS: Xcode command-line tools.
- Windows: WebView2 (bundled on modern Windows).

The Rust code is tiny — literally just a window pointing at `../../web/index.html`. All signing logic runs in the WebView.

### Install natively on Arch

After a Tauri release build, install as a real pacman package:

```sh
cd tauri/src-tauri && cargo build --release && cd -
cd packaging/pkg && makepkg -fi
```

`pdf-signer` lands in `$PATH` and shows up in the GNOME app grid. Uninstall with `sudo pacman -R pdf-signer`.

## Electron

```sh
cd electron
npm install
npm start            # runs the app
npm run dist         # builds .deb + AppImage on Linux and .dmg on Mac
```

Same UI as Web/Tauri but with bundled Chromium and Node.

## Identity model

- Each identity is a self-signed 2048-bit RSA + X.509 cert (10-year validity), stored as an encrypted PKCS#12 in IndexedDB.
- Password-protected; asked once per session for signing.
- Export/import as `.pdfsigner.json` bundles containing the encrypted p12 + optional signature PNG.
- Signature image (photo of your signature on paper; background auto-removed) belongs to each identity individually.

## Signature model

- One cryptographic signature per PDF (CMS/PKCS#7 detached, `adbe.pkcs7.detached`, SHA-256, RSA).
- Multiple visible marks share that one signature (multi-widget kids of one form field).
- Per-placement appearance: **text block** (name / date / reason / location, no background) / **image only** (your PNG) / **image + text**.
- **Lock document** = DocMDP P=1 (viewers enforce no further edits).
- **Void on change** = no DocMDP; edits are allowed but crypto verification fails.

## Verify

Sidebar → **Verify signed PDF…** or open a signed PDF. Auto-verifies on open and:
- Green ✓ badge over each valid signature widget.
- Yellow ! badge if bytes exist outside the signed range (modified after signing).
- Red ✕ badge + red tint over the whole widget if the SHA-256 doesn't match (tampered).
- Blue ? badge for empty signature form fields (unsigned placeholder).
