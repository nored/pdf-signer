# PDF Signer — Tasks

Priorities set 2026-09-17. The load-bearing use case is writing thesis review reports and signing them, sometimes as one of two supervisors. The app is used only via the web build hosted on GitHub Pages — Tauri and Electron wrappers are not in scope right now.

## Trust & verification

- [x] **RFC 3161 timestamping.** Hand-rolled TimeStampReq builder + response parser + unauth-attribute embedder in the CMS (`id-aa-timeStampToken`). Sign path now optionally calls a TSA after computing the RSA signature; the returned token is attached as a SignerInfo unauthenticated attribute. Verifier detects the token, parses TSTInfo, and shows a "Trusted timestamp: ✓ &lt;time&gt; · TSA: &lt;subject&gt;" line. UI: per-sidebar toggle + TSA URL (freeTSA default) under "After signing", automatically suppressed when "Sign as of" is set (backdated M contradicts a TSA time). CORS-blocked TSAs surface a clear error message; freeTSA works from Node — needs browser-side verification against whichever TSA the user configures. Verified end-to-end against `https://freetsa.org/tsr`: built request, got back a token, embedded into a synthetic CMS, parsed back the trusted time, `messageImprint` matches the signature bytes.
- [ ] **Cert-chain validation on verify.** Bundle a small trust store of root PEMs (user-editable in settings). On verify, walk the chain and show a warning banner when the signature is cryptographically valid but the cert doesn't chain to a trusted root. Today verify stops at "bytes match".
- [ ] **Bring-your-own signing cert.** Import a p12 whose cert was issued by a real CA (SRH / your organisation / an eIDAS token via PKCS#11 in a later pass). Today every identity is self-signed inside the app, which is fine for internal use and useless for external verification.

## PDF coverage

- [x] **Xref-stream parsing.** `parsePdfForIncremental` now reads the trailer info at either a classical `xref\n...trailer <<...>>` block or an xref-stream object (`N G obj\n<< /Type /XRef ... >>`). Object bodies are read/mutated via pdf-lib, which handles classical, stream, and hybrid xrefs and also decodes object streams. Verified round-trip on both a classical-xref two-supervisor flow and a pdf-lib `useObjectStreams:true` xref-stream PDF. Surgical redaction was already using pdf-lib for its reads and inherits the fix.
- [x] **Rotated-page handling.** Surgical redaction now works on /Rotate 90 pages — root cause turned out to be unrelated to rotation: `shouldRedactAt` required a string match between the raw Tj bytes and pdf.js's Unicode-decoded item, which failed for any text containing WinAnsi-only characters (em-dash, curly quotes, accented letters). Match by pen position only; that's unambiguous for a rect the user drew over that spot. Raster fallback also rewritten to convert PDF-space rects through `vp.convertToViewportPoint` (rotation-aware) instead of the old unrotated y-flip.
- [x] **Encrypted PDF support (view + verify only, this pass).** Open flow catches pdf.js's `PasswordException`, prompts for the password in a modal, and retries; wrong password re-prompts. Doc gains `isEncrypted` state; a red banner explains the current limit and every write tool (Sign, Text, Redact, Stamp) refuses. Full signing on encrypted PDFs (decrypt content bytes, re-encrypt after modifications) is a bigger project — punt to a follow-up if there's demand.

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
