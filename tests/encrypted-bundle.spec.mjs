import { test, expect, createIdentity } from './fixtures.mjs';

test('encrypted bundle round-trip: export → wipe → import', async ({ page }) => {
  await createIdentity(page, { label: 'Round-trip', name: 'Ada RT', email: 'ada@rt.edu' });

  // Export. createIdentity already cancels the auto-open Export modal; click
  // btnExportId to open a fresh one.
  await page.click('#btnExportId');
  await page.locator('#bpw').waitFor({ state: 'visible', timeout: 10_000 });
  await page.fill('#bpw', 'bundlepassword1');
  await page.fill('#bpw2', 'bundlepassword1');
  // The sidebar also has an "Export" button, so scope the modal button lookup
  // to inside the modal to avoid a strict-mode selector collision.
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#modalRoot').getByRole('button', { name: 'Export' }).click(),
  ]);
  const bundlePath = await dl.path();
  const fs = await import('fs/promises');
  const bundleBytes = await fs.readFile(bundlePath);
  const bundleText = bundleBytes.toString('utf8');
  expect(bundleText).toContain('"version": 3');
  expect(bundleText).toContain('"ciphertext_b64"');

  // Wipe local state.
  await page.evaluate(async () => {
    await new Promise(res => { const rq = indexedDB.deleteDatabase('pdf-signer'); rq.onsuccess = rq.onerror = rq.onblocked = () => res(); });
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.forge !== 'undefined');
  await expect(page.locator('#idText')).toHaveText(/No identity/);

  // Import — since Playwright's setInputFiles works on <input type="file">, and
  // pickFile creates the input dynamically, we hook window.pickFile to return
  // our bundle as a File.
  await page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
    const file = new File([u8], name, { type: 'application/json' });
    const orig = window.pickFile;
    window.pickFile = async () => file;
    setTimeout(() => { window.pickFile = orig; }, 5000);
  }, { b64: bundleBytes.toString('base64'), name: 'round-trip.pdfsigner.json' });
  // #btnImportId is inside a collapsed <details id="idSettings"> after reload;
  // open it before clicking.
  await page.evaluate(() => { const d = document.getElementById('idSettings'); if (d) d.open = true; });
  await page.click('#btnImportId');
  await page.locator('#bpw').waitFor({ state: 'visible', timeout: 10_000 });
  await page.fill('#bpw', 'bundlepassword1');
  await page.locator('#modalRoot').getByRole('button', { name: 'Decrypt' }).click();
  // Then unlock the p12 with the identity password.
  await page.locator('#pw').waitFor({ state: 'visible', timeout: 10_000 });
  await page.fill('#pw', 'hunter2xx');
  await page.locator('#modalRoot').getByRole('button', { name: 'Import' }).click();

  await expect(page.locator('#idText')).toHaveText(/Ready/);
  await expect(page.locator('#idName')).toContainText('Ada RT');
});
