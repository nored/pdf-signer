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
