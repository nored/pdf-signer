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
  await page.click('#btnCreateId');
  await page.fill('#label', label);
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#pw', password);
  await page.fill('#pw2', password);
  await page.getByRole('button', { name: 'Generate' }).click();
  // The auto-export dialog appears after generation. Cancel it for the test.
  const cancel = page.getByRole('button', { name: 'Cancel' });
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  await expect(page.locator('#idText')).toHaveText(/Ready/);
  return password;
}
