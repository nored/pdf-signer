# pdf-signer

A single-page browser tool that cryptographically signs PDFs, hosts encrypted verification vaults on your own GitHub repo, and reads back signatures anyone else's copy of it can verify. The app runs in the browser. The optional GitHub vault stores an encrypted copy of the signed file.

**Live app: <https://nored.github.io/pdf-signer/web/>**

GitHub Pages serves the web version. The Tauri desktop app bundles the same web source. The separate Electron prototype is archived in the source tree.

## What it does

- Place signatures, text, and QR verification stamps on supported PDFs. Redaction removes selected content from an unsigned PDF while keeping the remaining text searchable. The export rewrites the PDF and removes embedded file attachments.
- Emits PAdES-B-B (`SubFilter /ETSI.CAdES.detached`, hand-rolled `SigningCertificateV2` with real `ESSCertIDv2`, populated `issuerSerial`, DER-sorted signedAttrs, RSA-SHA256).
- Countersigns with an RFC 3161 timestamp from a browser-reachable TSA (via `rfc3161.ai.moda` by default; others accepted if they send CORS headers).
- Multi-party incremental signing that preserves earlier signatures byte-for-byte (splices `/Fields` and `/Annots` without touching prior object bodies, so DocMDP P=3 stays valid under strict Adobe verification).
- Signs into pre-existing empty AcroForm signature fields when the source has them.
- Optional Ghostscript-WASM PDF/A-2b conversion at open time for Office-generated source PDFs (Word / Google Docs / iLovePDF pre-2.0) that Adobe otherwise rejects post-sign.
- Uploads an AES-256-GCM-encrypted copy of the signed PDF to a GitHub repo you control, prints a QR on every page linking back to the built-in verifier.
- The verifier fetches the vault over HTTPS, decrypts it in the browser, checks supported CMS signatures against their PDF signature fields, and shows which revision each signature covers. It can produce a printable verification receipt with a link back to the vault.
- Compares signature revisions side by side; pixel-diffs each page so a recipient can see exactly what a downstream signer added.

## Try it

Open <https://nored.github.io/pdf-signer/web/>, generate an identity (name + password), drop a PDF, click **Sign & Download**. Signed file downloads to the same place your browser puts everything else. Signing can also publish your public certificate and an encrypted vault to the GitHub repository you configure. An optional timestamp request sends a digest to the configured timestamp authority.

Long-press the theme toggle (◐, top-right) to see which commit your browser is on and whether it's the latest.

## Privacy

Everything runs in the browser tab.

- Documents never leave your machine unless you explicitly configure a GitHub vault, and even then they leave as AES-256-GCM ciphertext keyed by a byte string that lives only in the QR you print on the signed PDF. Without that QR, the vault contents are opaque even to whoever hosts them (including GitHub and any downstream mirror).
- The private key is stored in a password-protected PKCS#12 bundle. The signature image and GitHub configuration, including any token, use AES-GCM with a non-extractable key stored by the browser for this site. The browser can decrypt those settings without the identity password. Scripts running in the app's origin can access them.
- The app loads pinned rendering and cryptography libraries from CDNs and can load Ghostscript-WASM for normalization. Verification can fetch the vault and its published certificate. The app uses GitHub's API for vault operations and to check the deployed version.
- Anyone who has a vault QR or its full link has the decryption key. Share it with the intended recipients.

For local signing, choose a signature appearance without a QR stamp and disable timestamping. The browser still needs access to the app and its dependencies unless it has them cached.

## Setup

Create a signing identity, then configure the integrations you use.

**1. Create your identity.** Sidebar → **New identity…**, enter your name (goes into the cert CN and the visible signature), your email (goes into the cert subjectAltName), and a password of at least 6 characters. Generates a 2048-bit RSA keypair, self-signs a 10-year cert, encrypts the p12 with your password, and stores it in IndexedDB. Downloads an encrypted backup bundle (`.pdfsigner.json`) immediately. Keep that file somewhere safe; it's the only way to move the identity to another browser.

Alternatively **Import…** an existing p12 from any CA (D-Trust, Bundesdruckerei, Certum, GlobalSign, sign-me, corporate CA). Importing an identity does not add its certificate chain to the trust store. In **Trust store**, select **Trust current identity’s root** to trust the active identity on this browser. Use **Add PEM** for other roots after verifying their fingerprints.

**2. Configure a GitHub vault (optional).** If you want the QR-based public verification, sidebar → **GitHub vault → Configure…**. Use a fine-grained token limited to the selected vault repository with read/write access to Contents. The app creates a public repo named `pdf-signer-vault` (customizable), publishes your cert to `vault/certs/<sha1>.pem`, and uploads one encrypted `.vault` file per signed PDF. The signed PDF carries the raw HTTPS URL of the vault plus (in the QR) the AES key.

Without a vault, signing still works. Signed PDFs are valid; the verifier just needs the `.vault` file handed over locally (drag-and-drop) instead of fetched from a URL.

**3. Turn on trusted timestamping (optional).** Under **Timestamp token (RFC 3161)** in the signing sidebar, tick the checkbox. Default TSA is `https://rfc3161.ai.moda` (a relay that accepts browser CORS). When the TSA responds with a matching token, the app embeds it. The built-in verifier displays the token time and imprint result. Use a validator that authenticates the TSA when relying on that time.

**4. Turn on PDF normalization (optional).** Under **PDF normalization** in identity settings, tick **Normalize source PDFs before signing** if you regularly sign Office / Word / Google-Docs PDFs. Lazy-loads Ghostscript-WASM on first use (~5 MB gzipped, browser-cached thereafter, only fetched when a source PDF has the structural markers Adobe rejects post-sign).

Every setting is per-identity. Export the identity bundle and every setting travels with it.

## How signatures work here

- Each identity is a 2048-bit RSA keypair with a self-signed X.509 (10-year validity), stored as an encrypted PKCS#12 inside IndexedDB. Password-protected. Never leaves your machine except in the export bundle.
- The signing certificate can also be published (once, by you) to a public GitHub repo. The signed PDF's `/Sig` dict carries the raw URL. The verifier can compare the fetched certificate with the one in the signature. A match does not establish the signer's identity.
- Bring-your-own certs via `.p12` import work too: full chain (leaf + intermediates + root) is walked, all intermediates go into the CMS, verifiers reach whatever root is in their store.
- Every signature: `adbe.pkcs7.detached` in the legacy phrasing, `ETSI.CAdES.detached` in the SubFilter. Hand-rolled `SignerInfo` because `node-forge.pkcs7` cannot emit `SigningCertificateV2` correctly (silently produces an empty SET; Adobe strict-CAdES rejects that plus everything downstream).

## Multi-party workflows

Create any text fields and digital signature fields before the first signature. Each reviewer can fill their section and sign using **Leave open for form filling and signing**. The first signer can also choose **Certify with permissions** to allow form filling and signing, with optional annotations. Use **Lock individual form fields** to protect selected fields and leave the other fields available for later reviewers. For certification without annotations, prepare a signature field for each reviewer before the first signature. Save the current PDF and pass that file to the next reviewer.

In Acrobat, click the existing fillable fields to enter text and use a digital signature field or **Use a certificate** to sign. **Edit PDF** changes page content. Make those changes in the unsigned original before circulating it. Converting a signed PDF to images drops the digital signatures and retains only their visible appearance.

Choose **Lock document** once every reviewer has finished. The first signer can apply a certification lock. A later signer can lock the form fields, including signature fields.


- **Head signer + downstream cooperative tools** (Adobe Acrobat proper, this app, DocuSign that does true incremental sign): head signature stays valid after every downstream sig. Head can use P=3 (Certify, allow further signatures) safely.
- **Head signer + non-cooperative tools** (Apple Preview, iLovePDF sign flow, most web "sign PDF" services): downstream rewrites the file, head signature's byte range no longer covers what's on disk, crypto fails. No PDF technology fixes this. Workaround: sign last, or use P=1 lock and accept no downstream changes.
- **Approval-only signatures** (No certification): only assert "I signed these bytes." Survive any downstream operation that appends rather than rewrites. Recommended default when you cannot control what the next signer will use.

## Adobe compatibility notes

- Silent green check requires a signer cert whose root is on Adobe's AATL. Self-signed certs get a yellow "unknown identity" warning under Adobe; the signature itself is still cryptographically valid and every non-Adobe verifier accepts it (poppler `pdfsig`, EU-DSS `verifysignature.eu`, openssl `cms -verify`).
- Office / Word / Google-Docs-generated source PDFs pin `/Version /1.4` in the catalog and ship a fragmented xref with free object slots. Adobe rejects our CAdES signature over those with "document has been modified" even though nothing was modified. Fix: enable **Normalize source PDFs before signing** in identity settings. Runs a proper PDF/A-2b conversion via Ghostscript-WASM (lazy-loaded from jsDelivr, ~5 MB gzipped, only fetched when a source actually needs it, browser-cached afterwards).
- Trusted-time from a TSA needs a TSA on Adobe's own TSA trust list. The default `rfc3161.ai.moda` relays requests to commercial timestamp authorities and supports browser CORS. The built-in verifier displays the claimed token time separately from signer trust.

## Verifying signatures

The app checks supported CMS signatures and their revision coverage. It also checks selected field values against active locks. The app collects available OCSP evidence for supported signing chains and embeds it in the PDF’s document security store (DSS). A later signature preserves existing DSS entries. The built-in verifier does not authenticate the TSA chain or revocation evidence or fully classify DocMDP changes. Use an independent PDF validator for those checks.

1. **In-app**: open any PDF, verify runs automatically, per-signature badges appear on each widget.
2. **Public QR link**: scan the QR on any signed page, land on the verifier URL, the vault decrypts client-side and the check runs. The verification view reports the latest byte check and shows earlier signatures separately. Verification receipt (PDF) downloadable with a QR back to the live check.
3. **Independent tools**: `openssl cms -verify -inform DER -in signed.cms.der -content signed.range.bin -binary` and poppler `pdfsig signed.pdf` can independently check signatures produced by the app. `verifysignature.eu` (EU-DSS reference validator) also accepts and prints "Integrity: Preserved".

## Identity and vault storage

- The password protects the PKCS#12 key bundle. Vault settings and the signature image use the browser storage key described above.
- Export identity as `.pdfsigner.json` (encrypted bundle: p12 + signature image + settings + optional GitHub config). The encrypted backup includes the GitHub token by default. Uncheck “Include the GitHub token” to omit it.
- Import bundle on another machine, unlock once, continue.
- GitHub vault repo: a public repo you own. Each signed PDF gets encrypted (AES-256-GCM) with a fresh random key, uploaded as `vault/<hash>.vault`. QR carries the key; only the QR-holder can decrypt.
- Cert publish repo: same repo, `vault/certs/<fingerprint>.pem`. Cert itself is not sensitive; anyone can fetch and verify against it.

## Development

Serve `web/index.html` over HTTP on localhost. After editing its inline script, run `node scripts/update-web-csp.mjs` to refresh the Content Security Policy hash.

```sh
git clone https://github.com/nored/pdf-signer
cd pdf-signer
python3 -m http.server 8000        # or `npx serve`, whatever
open http://localhost:8000/web/
```

Runtime deps loaded from CDN (cdnjs and jsdelivr): `pdf.js` (Mozilla), `pdf-lib` (Hopding), `node-forge` (Digital Bazaar), `qrcode-generator` (Kazuhiko Arase), optionally `@okathira/ghostpdl-wasm` (Artifex GhostPDL via jsdelivr, only if the user enables PDF normalization).

Run the Playwright suite with `npm --prefix tests test`. See [the test guide](tests/README.md) for setup and optional cross-viewer fixtures.

## Tauri desktop app

The desktop app bundles `web/` and uses the system webview. Its identity database is separate from the hosted app. Use an encrypted `.pdfsigner.json` backup to bring over your signing identity and optional GitHub vault configuration. The same CDNs and network integrations are used as in the web app.

Run the desktop app during development or build a local macOS bundle:

```sh
cd tauri
npm ci
npm run dev
APPLE_SIGNING_IDENTITY=- npm run build -- --bundles app
```

The bundle is at `tauri/src-tauri/target/release/bundle/macos/PDF Signer.app` relative to the repository root. The `-` identity applies an ad-hoc signature for local testing.

For distribution outside the Mac App Store, install your **Developer ID Application** certificate and its private key in Keychain. Find the signing identity with `security find-identity -v -p codesigning`, set `APPLE_SIGNING_IDENTITY` to that identity, and run `npm run build:dmg`. For notarization, set up the Apple credentials described in the [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/). Keep those credentials outside the repository.

## License

pdf-signer itself: MIT (see `LICENSE`).

Runtime-only optional dependency Ghostscript-WASM is AGPL-3.0-or-later (upstream Artifex build, unmodified, fetched by the user's browser directly from jsDelivr when the PDF normalization toggle is on). pdf-signer does not bundle, distribute, or modify it. See `NOTICE`.
