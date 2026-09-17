# pdf-signer E2E tests

Playwright smoke tests that boot the app in a real browser, click through the load-bearing flows, and verify the outputs.

## Setup

```sh
cd tests
npm install
npx playwright install --with-deps chromium
```

## Run

```sh
cd tests
npm test                    # headless
npm run test:headed         # visible browser
npm run test:ui             # Playwright's watch/debug UI
```

The tests spin up a local static file server on a random port (see `serve.mjs`) and point Playwright at `http://localhost:<port>/web/index.html`. The app fetches pdf.js, pdf-lib and node-forge from cdnjs on first run — the test machine needs internet the first time. Browser cache keeps subsequent runs offline.

## What's covered

- **boot.spec.mjs** — app loads without console errors; the empty state renders.
- **identity.spec.mjs** — create a new identity via the modal; identity shows as "Ready" in the sidebar.
- **sign.spec.mjs** — build a tiny synthetic PDF, drop it into the app, place a signature, sign, verify a download landed with `-signed.pdf` in the name.
- **redact.spec.mjs** — drop the same synthetic PDF, arm the redact tool, drag over the target text, sign, download; the output's extracted text is missing the redacted line.
- **encrypted-bundle.spec.mjs** — export an identity with a password, wipe IndexedDB, import the bundle with the right password, verify the identity is back and the GitHub token round-trips.

Each spec builds its own fixture PDFs on the fly with pdf-lib (via a `<script type=module>` shim in the page), so no static PDFs live in the repo.
