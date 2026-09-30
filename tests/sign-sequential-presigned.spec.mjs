import { test, expect, dropPdf } from './fixtures.mjs';
import fs from 'node:fs';

// This regression uses a real Adobe-signed thesis review PDF that lives
// outside the repo (Klaus's day-to-day). Skip when it isn't present so CI
// stays green — anyone can point PDFSIGNER_PRESIGNED_FIXTURE at their own
// Adobe-signed PDF to run it locally.
const PRESIGNED_FIXTURE =
  process.env.PDFSIGNER_PRESIGNED_FIXTURE ||
  '/Users/schwarz/Downloads/Thesis_Bewertung_Pradeep.pdf';

test('sequentially sign an Adobe-signed PDF with stamp appearance + field-lock', async ({ page }) => {
  test.skip(!fs.existsSync(PRESIGNED_FIXTURE),
    `Set PDFSIGNER_PRESIGNED_FIXTURE to an Adobe-signed PDF to run this test.`);
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

  // Build an in-page identity so the test doesn't fight the disclosure UI.
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
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
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

  // Stamp appearance is the default now; explicitly click Lock.
  const lockRadio = page.locator('input[name="lockmode"][value="locked"]');
  await lockRadio.evaluate(el => el.click());

  await page.click('#btnPlaceSig');
  const wrap = page.locator('.page-wrap').first();
  const box  = await wrap.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);

  const signBtn = page.locator('#btnSign');
  await expect(signBtn).toBeEnabled();

  // Kick off signing; fill the unlock modal that appears.
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await signBtn.click();
  const pwInput = page.locator('#pw');
  await pwInput.waitFor({ timeout: 10_000 });
  await pwInput.fill('hunter2xx');
  await page.getByRole('button', { name: 'Unlock' }).click();
  const download = await downloadPromise;
  const outPath = await download.path();
  const outBytes = new Uint8Array(fs.readFileSync(outPath));
  // Also save a copy next to the input so a human can open and inspect it.
  if (process.env.PDFSIGNER_KEEP_OUTPUT) {
    const outCopy = PRESIGNED_FIXTURE.replace(/\.pdf$/i, '-preview-stamp-signed.pdf');
    fs.writeFileSync(outCopy, outBytes);
    console.log('kept signed preview at', outCopy);
  }

  // Verify both signatures and the /Lock + /FieldMDP presence.
  const verifyResult = await page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const results = window.verifyPdfSignatures(u8);
    const text = new TextDecoder('latin1').decode(u8);
    return {
      count: results.length,
      results: results.map(r => ({
        cn: r.cn, error: r.error, cryptoValid: r.cryptoValid,
        digestMatch: r.digestMatch, rsaOk: r.rsaOk,
      })),
      hasLock: /\/Lock\s*<<[^>]*\/Action\s*\/All/.test(text),
      hasFieldMDP: /\/TransformMethod\s*\/FieldMDP/.test(text),
      bytesLen: u8.length,
    };
  }, { b64: Buffer.from(outBytes).toString('base64') });

  console.log('VERIFY:', JSON.stringify(verifyResult, null, 2));
  console.log('LOGS TAIL:\n' + logs.slice(-30).join('\n'));

  expect(verifyResult.count).toBeGreaterThanOrEqual(2);
  // Every signature parses and verifies cryptographically — both the prior
  // signer's and the one we just added.
  for (const r of verifyResult.results) {
    expect(r.error, `unexpected verify error: ${r.error}`).toBeFalsy();
    expect(r.cryptoValid, `sig for "${r.cn}" must be cryptoValid`).toBe(true);
  }
  const klausSig = verifyResult.results.find(r => (r.cn || '').includes('Klaus'));
  expect(klausSig, 'the new stamp signature by Prof. Klaus Schwarz should be present').toBeTruthy();
  expect(verifyResult.hasLock, '/Lock dict with /Action /All must be present').toBe(true);
  expect(verifyResult.hasFieldMDP, '/Reference FieldMDP must be present on the sig dict').toBe(true);
});
