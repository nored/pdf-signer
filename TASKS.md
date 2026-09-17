# PDF Signer — Tasks

Priorities set 2026-09-17. The load-bearing use case is writing thesis review reports and signing them, sometimes as one of two supervisors. The app is used only via the web build hosted on GitHub Pages — Tauri and Electron wrappers are not in scope right now.

## Trust & verification

- [x] **RFC 3161 timestamping.** Hand-rolled TimeStampReq builder + response parser + unauth-attribute embedder in the CMS (`id-aa-timeStampToken`). Sign path now optionally calls a TSA after computing the RSA signature; the returned token is attached as a SignerInfo unauthenticated attribute. Verifier detects the token, parses TSTInfo, and shows a "Trusted timestamp: ✓ &lt;time&gt; · TSA: &lt;subject&gt;" line. UI: per-sidebar toggle + TSA URL (freeTSA default) under "After signing", automatically suppressed when "Sign as of" is set (backdated M contradicts a TSA time). CORS-blocked TSAs surface a clear error message; freeTSA works from Node — needs browser-side verification against whichever TSA the user configures. Verified end-to-end against `https://freetsa.org/tsr`: built request, got back a token, embedded into a synthetic CMS, parsed back the trusted time, `messageImprint` matches the signature bytes.
- [x] **Cert-chain validation on verify.** User-editable trust store (root PEMs) lives in IndexedDB under a reserved key, backed by `forge.pki.createCaStore()`. Sidebar section lets the user paste in PEM roots and remove them; each row shows CN / O / expiry. On verify, `verifyChain(signerCert, allCertsInCms)` walks the chain via `forge.pki.verifyCertificateChain`. Verifier now shows one of three lines per signature: "chains to a trusted root" (green), "self-signed" (amber — trust depends on how you got the cert), or "chain not verified" (amber, with the reason from forge). Verified end-to-end with a synthetic root → intermediate → signer hierarchy: real root added → verifies, wrong root → refused, empty store → refused.
- [x] **Bring-your-own signing cert (with chain).** `unlockP12` now collects every cert in the p12 bundle, picks the leaf (the cert nobody in the bundle issued), and reconstructs the chain leaf → issuer → root by walking `issuer.hash → subject.hash`. Sign paths embed the full chain in the CMS (`p7.addCertificate` per link), so external verifiers can walk up to a known root. Identity display shows "CA-issued (chain: N)" vs "self-signed" so the user knows what they imported. End-to-end tested: built a synthetic root → intermediate → leaf p12, unlockP12 recovers all three in order, root added to trust store → chain verifies. PKCS#11 hardware tokens are a follow-up.

## PDF coverage

- [x] **Xref-stream parsing.** `parsePdfForIncremental` now reads the trailer info at either a classical `xref\n...trailer <<...>>` block or an xref-stream object (`N G obj\n<< /Type /XRef ... >>`). Object bodies are read/mutated via pdf-lib, which handles classical, stream, and hybrid xrefs and also decodes object streams. Verified round-trip on both a classical-xref two-supervisor flow and a pdf-lib `useObjectStreams:true` xref-stream PDF. Surgical redaction was already using pdf-lib for its reads and inherits the fix.
- [x] **Rotated-page handling.** Surgical redaction now works on /Rotate 90 pages — root cause turned out to be unrelated to rotation: `shouldRedactAt` required a string match between the raw Tj bytes and pdf.js's Unicode-decoded item, which failed for any text containing WinAnsi-only characters (em-dash, curly quotes, accented letters). Match by pen position only; that's unambiguous for a rect the user drew over that spot. Raster fallback also rewritten to convert PDF-space rects through `vp.convertToViewportPoint` (rotation-aware) instead of the old unrotated y-flip.
- [x] **Encrypted PDF support (view + verify only, this pass).** Open flow catches pdf.js's `PasswordException`, prompts for the password in a modal, and retries; wrong password re-prompts. Doc gains `isEncrypted` state; a red banner explains the current limit and every write tool (Sign, Text, Redact, Stamp) refuses. Full signing on encrypted PDFs (decrypt content bytes, re-encrypt after modifications) is a bigger project — punt to a follow-up if there's demand.

## Ergonomics

- [ ] **Batch mode.** Drop N PDFs, apply the same placement + certify options, download N signed outputs.
- [x] **Sidebar page thumbnails.** Right-side collapsible panel with a click-to-jump list of page thumbnails. Toggle button in the toolbar (☰ Pages); open/closed state persists in localStorage. Thumbnails lazy-render at ~140px wide when they enter the panel's viewport (IntersectionObserver on the panel). A second IntersectionObserver on the main scroll area tracks which page has the largest visible ratio and highlights its thumb with an accent border, auto-scrolling the panel to keep the current thumb in view.
- [x] **Autosave placements per document hash.** SHA-256 of the input bytes keys an IndexedDB record under `_placements/<hash>` containing the full placement snapshot (positions, typography, redaction rects, everything `snapshotPlacements` captures). Debounced 400ms save fires on every mutation via `renderPlacementList` / `commitPlacementFromDom` hooks. On open, if a record exists for that exact file, placements come back and a toast reports how many. Empty snapshot deletes the record. Skipped for already-signed and encrypted PDFs where placements wouldn't apply.

## Reliability & testing

- [ ] **Playwright E2E tests.** Cover the two-supervisor flow, redact-then-sign, encrypted bundle round-trip, form-field fill, zoom-then-place.
- [ ] **Split the ~5000-line HTML into ES modules.** `signing.js`, `redaction.js`, `verify.js`, `bundle.js`, `ui.js` — each testable in isolation. The single-file `web/index.html` remains the deploy target (concatenated at build time).

## Candidates surfaced during the current round

- **Let's Encrypt cert as signing identity.** The p12 importer already accepts any cert+key bundle. Add a two-file `.pem + privkey.pem` importer for the standard LE layout so users don't need `openssl pkcs12 -export` gymnastics. Caveat: LE certs identify a domain, not a person, and lack the Document Signing EKU Adobe demands; works for our own verifier and for any verifier that doesn't hard-require that EKU.
- **Vault-hosted self-signed cert as trust anchor.** Publish the identity's self-signed cert to the GitHub vault; embed the raw URL in the signature's `/Reason` (or a custom attribute). Verifier fetches the cert from that HTTPS URL, checks its leaf matches the signature's signer, and treats it as trusted-by-vault. Not PDF-canonical trust but maps well onto the existing github.io hosting pattern; effectively makes a self-signed key usable across machines without the recipient needing to add anything to their trust store.

## Not currently in scope

- Grading-specific workflow (templates for reviewer blocks, "sign 30 thesis reviews at once") — this is a general PDF signer.
- Tauri and Electron packaging / code-signing / release automation — the user only uses the hosted web build.
