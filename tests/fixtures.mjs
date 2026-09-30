// Shared fixtures + helpers for Playwright specs.
import { test as base, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { startServer } from './serve.mjs';

let serverStarted = null;
async function ensureServer() {
  if (!serverStarted) serverStarted = await startServer();
  return serverStarted;
}

// Wipe IndexedDB before each test so identities/trust roots don't leak
// between specs. Ensures each spec starts from a blank slate.
export const test = base.extend({
  page: async ({ page }, use) => {
    const s = await ensureServer();
    // Navigate to a clean-state URL, then delete IDB before the app boots on the real URL.
    await page.goto(s.url + '/web/index.html');
    await page.evaluate(async () => {
      await new Promise((res) => {
        const rq = indexedDB.deleteDatabase('pdf-signer');
        rq.onsuccess = rq.onerror = rq.onblocked = () => res();
      });
      try { localStorage.clear(); } catch (_) {}
    });
    await page.reload();
    // Wait for the pdf.js lib to be reachable (means external CDNs loaded).
    await page.waitForFunction(() => typeof window.pdfjsLib !== 'undefined' && typeof window.PDFLib !== 'undefined' && typeof window.forge !== 'undefined', { timeout: 30_000 });
    await use(page);
  },
});
export { expect };

// Build a synthetic PDF with the given lines and return a Uint8Array.
export async function makeFixturePdf(lines = ['SECRET line', 'PUBLIC line', 'Footer']) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 700;
  for (const line of lines) {
    page.drawText(line, { x: 60, y, size: 14, font });
    y -= 30;
  }
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

// Drop a PDF onto the app's scroll area by injecting a File through the drop handler.
export async function dropPdf(page, bytes, name = 'fixture.pdf') {
  // Playwright can't dispatch a real drag-and-drop DataTransfer with a File
  // across origins reliably, so we shortcut through the app's openPdf function.
  const b64 = Buffer.from(bytes).toString('base64');
  await page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
    const file = new File([u8], name, { type: 'application/pdf' });
    await window.openPdf(file);
  }, { b64, name });
}

// Create an identity via the New identity modal.
export async function createIdentity(page, { label = 'Test', name = 'Prof. Ada Lovelace', email = 'ada@example.edu', password = 'hunter2xx' } = {}) {
  // The "New identity" button lives inside a collapsed <details id="idSettings">
  // in the current UI. Open it before clicking.
  await page.evaluate(() => { const d = document.getElementById('idSettings'); if (d) d.open = true; });
  await page.click('#btnCreateId');
  // Set values directly via the DOM instead of page.fill for the password
  // fields — Chromium's password manager persists credentials across tests
  // within the same browser process and autofills them into the wrong field
  // when a second test opens the same modal, clobbering the identity form.
  // Direct value + input event bypasses autofill entirely.
  await page.evaluate(({ label, name, email, password }) => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('label', label);
    set('name', name);
    set('email', email);
    set('pw', password);
    set('pw2', password);
  }, { label, name, email, password });
  await page.getByRole('button', { name: 'Generate' }).click();
  // Wait for the identity to be created (#idText flips to Ready).
  await expect(page.locator('#idText')).toHaveText(/Ready/);
  // The app auto-clicks Export right after — a modal appears (or is about to
  // appear). Wait for it to be interactable and close it so it doesn't block
  // the next click in the test. It's actually the "Export identity bundle"
  // modal with its Cancel button, opened from btnExportId.click() at the end
  // of btnCreateId's handler.
  const cancel = page.getByRole('button', { name: 'Cancel' });
  try {
    await cancel.waitFor({ state: 'visible', timeout: 2000 });
    await cancel.click();
  } catch (_) { /* no dialog appeared — nothing to close */ }
  // Ensure the modal backdrop is gone before returning so later clicks aren't
  // intercepted by it.
  await page.waitForFunction(() => {
    const m = document.getElementById('modalRoot');
    return !m || m.style.display === 'none';
  }, { timeout: 3000 }).catch(() => {});
  return password;
}
