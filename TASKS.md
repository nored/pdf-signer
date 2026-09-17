# PDF Signer — Tasks

Priorities set 2026-09-17. The load-bearing use case is writing thesis review reports and signing them, sometimes as one of two supervisors. The app is used only via the web build hosted on GitHub Pages — Tauri and Electron wrappers are not in scope right now.

## Trust & verification

- [ ] **RFC 3161 timestamping.** Call a public TSA on sign; embed the token as an unauthenticated attribute in the CMS. Verifier reads it back and reports "signed before &lt;trusted time&gt;". Today `signingTime` is only the local clock. Notes:
  - **Mutually exclusive with backdating.** The existing "Sign as of" field must keep working — the load-bearing use case is signing a review report whose substantive decision was made earlier. When "Sign as of" is set, disable timestamping and show a small notice: "Backdating overrides trusted timestamps."
  - **CORS.** TSA calls from a browser origin need either a CORS-friendly TSA (freeTSA is best-effort) or a user-supplied proxy. Ship freeTSA as the default with a settings-level override URL so a user can point at their own proxy.
- [ ] **Cert-chain validation on verify.** Bundle a small trust store of root PEMs (user-editable in settings). On verify, walk the chain and show a warning banner when the signature is cryptographically valid but the cert doesn't chain to a trusted root. Today verify stops at "bytes match".
- [ ] **Bring-your-own signing cert.** Import a p12 whose cert was issued by a real CA (SRH / your organisation / an eIDAS token via PKCS#11 in a later pass). Today every identity is self-signed inside the app, which is fine for internal use and useless for external verification.

## PDF coverage

- [x] **Xref-stream parsing.** `parsePdfForIncremental` now reads the trailer info at either a classical `xref\n...trailer <<...>>` block or an xref-stream object (`N G obj\n<< /Type /XRef ... >>`). Object bodies are read/mutated via pdf-lib, which handles classical, stream, and hybrid xrefs and also decodes object streams. Verified round-trip on both a classical-xref two-supervisor flow and a pdf-lib `useObjectStreams:true` xref-stream PDF. Surgical redaction was already using pdf-lib for its reads and inherits the fix.
- [x] **Rotated-page handling.** Surgical redaction now works on /Rotate 90 pages — root cause turned out to be unrelated to rotation: `shouldRedactAt` required a string match between the raw Tj bytes and pdf.js's Unicode-decoded item, which failed for any text containing WinAnsi-only characters (em-dash, curly quotes, accented letters). Match by pen position only; that's unambiguous for a rect the user drew over that spot. Raster fallback also rewritten to convert PDF-space rects through `vp.convertToViewportPoint` (rotation-aware) instead of the old unrotated y-flip.
- [ ] **Encrypted PDF support.** Handle owner-password / AES-256 via pdf-lib's `ignoreEncryption` path plus a decrypt-on-open prompt when the file is password-protected.

## Ergonomics

- [ ] **Batch mode.** Drop N PDFs, apply the same placement + certify options, download N signed outputs.
- [ ] **Sidebar page thumbnails.** Click-to-jump nav for long documents.
- [ ] **Autosave placements per document hash.** Placements survive tab close / reload for the same PDF; stored in IndexedDB keyed by SHA-256 of the input bytes.

## Reliability & testing

- [ ] **Playwright E2E tests.** Cover the two-supervisor flow, redact-then-sign, encrypted bundle round-trip, form-field fill, zoom-then-place.
- [ ] **Split the ~5000-line HTML into ES modules.** `signing.js`, `redaction.js`, `verify.js`, `bundle.js`, `ui.js` — each testable in isolation. The single-file `web/index.html` remains the deploy target (concatenated at build time).

## Not currently in scope

- Grading-specific workflow (templates for reviewer blocks, "sign 30 thesis reviews at once") — this is a general PDF signer.
- Tauri and Electron packaging / code-signing / release automation — the user only uses the hosted web build.
