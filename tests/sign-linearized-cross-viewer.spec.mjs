// End-to-end regression: signing an Adobe-linearized PDF produces output
// that opens in every viewer we can drive locally — pdf.js (bundled),
// Poppler (pdftoppm, same engine as Evince), and Apple Preview.app
// (Preview.app itself, not just qlmanage — those are different code paths).
// This test is the guardrail for the linearized-incremental fix.
import { test, expect, dropPdf } from './fixtures.mjs';
import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PRESIGNED_FIXTURE =
  process.env.PDFSIGNER_PRESIGNED_FIXTURE ||
  '/Users/schwarz/Downloads/Thesis_Bewertung_Pradeep.pdf';

test('sign a linearized PDF: opens in pdf.js, Poppler, and Preview.app', async ({ page }) => {
  test.skip(!fs.existsSync(PRESIGNED_FIXTURE),
    `Set PDFSIGNER_PRESIGNED_FIXTURE to an Adobe-signed linearized PDF to run this test.`);

  await page.evaluate(async () => {
    const keys = window.forge.pki.rsa.generateKeyPair(2048);
    const cert = window.forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 3600e3 * 24 * 365);
    const attrs = [
      { name: 'commonName',   value: 'Prof. Klaus Schwarz' },
      { name: 'emailAddress', value: 'schwarz@example.edu' },
    ];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(keys.privateKey, window.forge.md.sha256.create());
    const p12Asn1 = window.forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'hunter2xx', {
      algorithm: '3des', generateLocalKeyId: true, friendlyName: 'Test',
    });
    const p12Der = window.forge.asn1.toDer(p12Asn1).getBytes();
    const p12U8  = Uint8Array.from(p12Der, c => c.charCodeAt(0));
    await window.upsertIdentity({
      label: 'Test', p12U8,
      meta: { name: 'Prof. Klaus Schwarz', email: 'schwarz@example.edu' },
      makeActive: true,
    });
  });

  const bytes = new Uint8Array(fs.readFileSync(PRESIGNED_FIXTURE));
  await dropPdf(page, bytes, PRESIGNED_FIXTURE.split('/').pop());
  await page.waitForSelector('.page-wrap', { timeout: 20000 });
  await page.waitForTimeout(400);

  await page.click('#btnPlaceSig');
  const wrap = page.locator('.page-wrap').first();
  const box  = await wrap.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 200);
  await page.waitForTimeout(200);

  await expect(page.locator('#btnSign')).toBeEnabled();
  const dp = page.waitForEvent('download', { timeout: 60_000 });
  await page.click('#btnSign');
  await page.locator('#pw').waitFor({ timeout: 10_000 });
  await page.fill('#pw', 'hunter2xx');
  await page.getByRole('button', { name: 'Unlock' }).click();
  const download = await dp;
  const outPath = await download.path();
  const outBytes = new Uint8Array(fs.readFileSync(outPath));

  // Only write an on-disk copy when the caller explicitly asks — otherwise
  // the test bloats the user's Downloads folder with a signed PDF they
  // never look at. Poppler / Preview / pdf.js are all fed from `outPath`
  // (Playwright's own download location, cleaned up per test run).
  if (process.env.PDFSIGNER_KEEP_OUTPUT) {
    const previewCopy = PRESIGNED_FIXTURE.replace(/\.pdf$/i, '-linearized-signed.pdf');
    fs.writeFileSync(previewCopy, outBytes);
    console.log('kept', previewCopy, 'size=', outBytes.length);
  }

  // 1. Both signatures verify cryptographically via pdf-signer's own verifier.
  const verify = await page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const results = window.verifyPdfSignatures(u8);
    return {
      count: results.length,
      results: results.map(r => ({ cn: r.cn, cryptoValid: r.cryptoValid, error: r.error })),
    };
  }, { b64: Buffer.from(outBytes).toString('base64') });
  console.log('VERIFY:', JSON.stringify(verify, null, 2));
  expect(verify.count).toBeGreaterThanOrEqual(2);
  for (const r of verify.results) {
    expect(r.error, `verify error: ${r.error}`).toBeFalsy();
    expect(r.cryptoValid, `cn=${r.cn}`).toBe(true);
  }

  // 2. pdf.js: page 1 has our new sig widget in its /Annots.
  const pdfjsResult = await page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const doc = await window.pdfjsLib.getDocument({ data: u8.slice() }).promise;
    const anns = await (await doc.getPage(1)).getAnnotations();
    return {
      pages: doc.numPages,
      p1SigWidgetCount: anns.filter(a => a.subtype === 'Widget' && (a.fieldType || '').toLowerCase() === 'sig').length,
    };
  }, { b64: Buffer.from(outBytes).toString('base64') });
  console.log('PDF.JS:', JSON.stringify(pdfjsResult));
  expect(pdfjsResult.p1SigWidgetCount, 'pdf.js must see the new sig widget on page 1').toBeGreaterThanOrEqual(1);

  // 3. Poppler (Evince engine): pdftoppm renders page 1 without error.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdftoppm-'));
  const poppler = spawnSync('pdftoppm', ['-r', '50', '-f', '1', '-l', '1', outPath, path.join(outDir, 'p')], { encoding: 'utf8' });
  console.log('POPPLER: exit=', poppler.status, 'stderr=', poppler.stderr);
  expect(poppler.status, `pdftoppm stderr: ${poppler.stderr}`).toBe(0);
  const rendered = fs.readdirSync(outDir);
  expect(rendered.length, 'pdftoppm should produce a PPM output').toBeGreaterThan(0);

  // 4. Apple Preview.app: open the file and confirm the window title reports
  //    "Seite 1 von N" / "Page 1 of N" instead of an error dialog.
  //    Skipped when not on macOS or when the user disables it via env.
  if (process.platform === 'darwin' && !process.env.PDFSIGNER_SKIP_PREVIEW_TEST) {
    // Kill any existing Preview window first so we're testing a fresh open.
    spawnSync('osascript', ['-e', 'tell application "Preview" to quit'], { timeout: 5000 });
    await new Promise(r => setTimeout(r, 1000));
    spawn('open', ['-a', 'Preview', outPath], { detached: true });
    // Wait for Preview to open the file — poll for up to 8 s.
    let title = '';
    for (let i = 0; i < 16; i++) {
      await new Promise(r => setTimeout(r, 500));
      const q = spawnSync('osascript', ['-e',
        'tell application "System Events" to tell process "Preview" to try\nreturn (name of every window) as string\non error\nreturn ""\nend try',
      ], { encoding: 'utf8' });
      title = (q.stdout || '').trim();
      if (title && !/error|fehler/i.test(title)) break;
    }
    console.log('PREVIEW window:', title);
    expect(title, `Preview.app must open the file (window title: "${title}")`).toMatch(/(?:Seite|Page)\s+\d+/i);
    // Leave Preview open so a human can eyeball the result.
  }
});
