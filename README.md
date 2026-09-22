# pdf-signer

A single-page browser tool that cryptographically signs PDFs, hosts encrypted verification vaults on your own GitHub repo, and reads back signatures anyone else's copy of it can verify. No server, no upload, no vendor account. One HTML file, ~500 KB gzipped, runs in Firefox / Chrome / Safari.

**Live app: <https://nored.github.io/pdf-signer/web/>**

## What it does

- Click-to-place signatures, text, redactions, and QR verification stamps on any PDF.
- Emits PAdES-B-B (`SubFilter /ETSI.CAdES.detached`, hand-rolled `SigningCertificateV2` with real `ESSCertIDv2`, populated `issuerSerial`, DER-sorted signedAttrs, RSA-SHA256).
- Countersigns with an RFC 3161 timestamp from a browser-reachable TSA (Sectigo via `rfc3161.ai.moda` by default; others accepted if they send CORS headers).
- Multi-party incremental signing that preserves earlier signatures byte-for-byte (splices `/Fields` and `/Annots` without touching prior object bodies, so DocMDP P=3 stays valid under strict Adobe verification).
- Signs into pre-existing empty AcroForm signature fields when the source has them.
- Opt-in Ghostscript-WASM PDF/A-2b conversion at open time for Office-generated source PDFs (Word / Google Docs / iLovePDF pre-2.0) that Adobe otherwise rejects post-sign.
- Uploads an AES-256-GCM-encrypted copy of the signed PDF to a GitHub repo you control, prints a QR on every page linking back to the built-in verifier.
- Verifier fetches the vault over HTTPS, decrypts client-side, runs a full CMS check, walks the cert chain, cross-references AATL / EUTL fingerprints, fetches OCSP if the AIA is browser-reachable, shows a per-signature timeline for multi-signed PDFs, and produces a printable verification receipt PDF with its own QR back to the live check.
- Compares signature revisions side by side; pixel-diffs each page so a recipient can see exactly what a downstream signer added.

## Try it

Open <https://nored.github.io/pdf-signer/web/>, generate an identity (name + password), drop a PDF, click **Sign & Download**. Signed file downloads to the same place your browser puts everything else. Nothing leaves the browser except an optional cert publish and vault upload, both to a GitHub repo you configure.

Long-press the theme toggle (◐, top-right) to see which commit your browser is on and whether it's the latest.

## Privacy

Everything runs in the browser tab.

- Documents never leave your machine unless you explicitly configure a GitHub vault, and even then they leave as AES-256-GCM ciphertext keyed by a byte string that lives only in the QR you print on the signed PDF. Without that QR, the vault contents are opaque even to whoever hosts them (including GitHub and any downstream mirror).
- Identity keys (RSA private key, PKCS#12 blob, signature image, GitHub token if you configured one) live in your browser's IndexedDB, encrypted at rest with your identity password. They're unlocked in memory for one signing session and discarded when you close the tab.
- No telemetry, no analytics, no third-party JS beacons. The only outbound requests during normal use are: PDF renderer / crypto libraries from `cdnjs.cloudflare.com` on first page load (then browser-cached), an optional TSA countersignature request to the TSA URL you set (default `rfc3161.ai.moda`), an optional GitHub API call to publish your public cert and upload the encrypted vault (only if you configured a GitHub vault), and an optional Ghostscript-WASM download from `cdn.jsdelivr.net` (only if you turn on PDF normalization and open a source PDF that needs it).
- On verify, the verifier fetches the vault file (from wherever the QR points), fetches OCSP responses if the AIA extension in the signer cert is browser-reachable, and does a single unauthenticated GitHub API call to detect whether the browser has the latest commit. Everything else is local.
- The verifier is a URL, not a service. A recipient scans the QR, lands on the same static HTML you signed with, decrypts and verifies in their own tab. Nothing hits a server you or they don't control.

If any of that is a step too many, disable the vault, disable the trusted timestamp, and sign offline. The signature is still a valid PAdES-B-B CMS; only the QR verification round-trip goes away.

## Setup

Zero install for the common case. For the recommended full experience, three optional steps:

**1. Create your identity.** Sidebar → **New identity…**, enter your name (goes into the cert CN and the visible signature), your email (goes into the cert subjectAltName), and a password of at least 6 characters. Generates a 2048-bit RSA keypair, self-signs a 10-year cert, encrypts the p12 with your password, and stores it in IndexedDB. Downloads an encrypted backup bundle (`.pdfsigner.json`) immediately. Keep that file somewhere safe; it's the only way to move the identity to another browser.

Alternatively **Import…** an existing p12 from any CA (D-Trust, Bundesdruckerei, Certum, GlobalSign, sign-me, corporate CA). The importer walks the p12's chain leaf → intermediates → root and self-trusts the root so it becomes visible to the verifier.

**2. Configure a GitHub vault (optional).** If you want the QR-based public verification, sidebar → **GitHub vault → Configure…**. You'll need a personal access token with `repo` scope. The app creates a public repo named `pdf-signer-vault` (customizable), publishes your cert to `vault/certs/<sha1>.pem`, and uploads one encrypted `.vault` file per signed PDF. The signed PDF carries the raw HTTPS URL of the vault plus (in the QR) the AES key.

Without a vault, signing still works. Signed PDFs are valid; the verifier just needs the `.vault` file handed over locally (drag-and-drop) instead of fetched from a URL.

**3. Turn on trusted timestamping (optional).** Under **Trusted timestamp (RFC 3161)** in the signing sidebar, tick the checkbox. Default TSA is `https://rfc3161.ai.moda` (a Sectigo relay that accepts browser CORS). Every signed PDF then carries a countersigned timestamp that survives your certificate expiring.

**4. Turn on PDF normalization (optional).** Under **PDF normalization** in identity settings, tick **Normalize source PDFs before signing** if you regularly sign Office / Word / Google-Docs PDFs. Lazy-loads Ghostscript-WASM on first use (~5 MB gzipped, browser-cached thereafter, only fetched when a source PDF has the structural markers Adobe rejects post-sign).

Every setting is per-identity. Export the identity bundle and every setting travels with it.

## How signatures work here

- Each identity is a 2048-bit RSA keypair with a self-signed X.509 (10-year validity), stored as an encrypted PKCS#12 inside IndexedDB. Password-protected. Never leaves your machine except in the export bundle.
- The signing certificate can also be published (once, by you) to a public GitHub repo. The signed PDF's `/Sig` dict carries the raw URL. Anyone verifying can fetch the cert over HTTPS and get transitive trust from the vault's HTTPS chain, no manual trust setup.
- Bring-your-own certs via `.p12` import work too: full chain (leaf + intermediates + root) is walked, all intermediates go into the CMS, verifiers reach whatever root is in their store.
- Every signature: `adbe.pkcs7.detached` in the legacy phrasing, `ETSI.CAdES.detached` in the SubFilter. Hand-rolled `SignerInfo` because `node-forge.pkcs7` cannot emit `SigningCertificateV2` correctly (silently produces an empty SET; Adobe strict-CAdES rejects that plus everything downstream).

## Multi-party workflows

The two-supervisor thesis review case is the load-bearing use case. What actually works and what doesn't:

- **Head signer + downstream cooperative tools** (Adobe Acrobat proper, this app, DocuSign that does true incremental sign): head signature stays valid after every downstream sig. Head can use P=3 (Certify, allow further signatures) safely.
- **Head signer + non-cooperative tools** (Apple Preview, iLovePDF sign flow, most web "sign PDF" services): downstream rewrites the file, head signature's byte range no longer covers what's on disk, crypto fails. No PDF technology fixes this. Workaround: sign last, or use P=1 lock and accept no downstream changes.
- **Approval-only signatures** (No certification): only assert "I signed these bytes." Survive any downstream operation that appends rather than rewrites. Recommended default when you cannot control what the next signer will use.

## Adobe compatibility notes

- Silent green check requires a signer cert whose root is on Adobe's AATL. Self-signed certs get a yellow "unknown identity" warning under Adobe; the signature itself is still cryptographically valid and every non-Adobe verifier accepts it (poppler `pdfsig`, EU-DSS `verifysignature.eu`, openssl `cms -verify`).
- Office / Word / Google-Docs-generated source PDFs pin `/Version /1.4` in the catalog and ship a fragmented xref with free object slots. Adobe rejects our CAdES signature over those with "document has been modified" even though nothing was modified. Fix: enable **Normalize source PDFs before signing** in identity settings. Runs a proper PDF/A-2b conversion via Ghostscript-WASM (lazy-loaded from jsDelivr, ~5 MB gzipped, only fetched when a source actually needs it, browser-cached afterwards).
- Trusted-time from a TSA needs a TSA on Adobe's own TSA trust list. The default `rfc3161.ai.moda` proxies to Sectigo (a real commercial TSA) and works from browsers. Adobe shows the trusted time; the verifier here shows it regardless.

## Verifying signatures

Three paths, all backed by the same CMS+chain code:

1. **In-app**: open any PDF, verify runs automatically, per-signature badges appear on each widget.
2. **Public QR link**: scan the QR on any signed page, land on the verifier URL, the vault decrypts client-side and the check runs. Non-technical recipient sees a plain green / yellow / red status; a first-visit help panel explains what each state means. Verification receipt (PDF) downloadable with a QR back to the live check.
3. **Independent tools**: `openssl cms -verify -inform DER -in signed.cms.der -content signed.range.bin -binary` and poppler `pdfsig signed.pdf` both accept every signature this tool produces. `verifysignature.eu` (EU-DSS reference validator) also accepts and prints "Integrity: Preserved".

## Identity and vault storage

- Identities live in IndexedDB, encrypted at rest with your password.
- Export identity as `.pdfsigner.json` (encrypted bundle: p12 + signature image + settings + optional GitHub config).
- Import bundle on another machine, unlock once, continue.
- GitHub vault repo: a public repo you own. Each signed PDF gets encrypted (AES-256-GCM) with a fresh random key, uploaded as `vault/<hash>.vault`. QR carries the key; only the QR-holder can decrypt.
- Cert publish repo: same repo, `vault/certs/<fingerprint>.pem`. Cert itself is not sensitive; anyone can fetch and verify against it.

## Development

Single file. Open `web/index.html` in a browser. Any change reloads instantly.

```sh
git clone https://github.com/nored/pdf-signer
cd pdf-signer
python3 -m http.server 8000        # or `npx serve`, whatever
open http://localhost:8000/web/
```

Runtime deps loaded from CDN (cdnjs and jsdelivr): `pdf.js` (Mozilla), `pdf-lib` (Hopding), `node-forge` (Digital Bazaar), `qrcode-generator` (Kazuhiko Arase), optionally `@okathira/ghostpdl-wasm` (Artifex GhostPDL via jsdelivr, only if the user enables PDF normalization).

Node-side tests in `scratchpad/test/` cover the load-bearing crypto paths (incremental signing byte-preserving splice, redaction round-trip, hand-rolled SignerInfo, DSS/OCSP embedding, PDF/A normalization end-to-end).

## License

pdf-signer itself: MIT (see `LICENSE`).

Runtime-only optional dependency Ghostscript-WASM is AGPL-3.0-or-later (upstream Artifex build, unmodified, fetched by the user's browser directly from jsDelivr when the PDF normalization toggle is on). pdf-signer does not bundle, distribute, or modify it. See `NOTICE`.
