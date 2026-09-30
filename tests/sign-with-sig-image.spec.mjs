import { test, expect, dropPdf } from './fixtures.mjs';
import fs from 'node:fs';

const PRESIGNED_FIXTURE =
  process.env.PDFSIGNER_PRESIGNED_FIXTURE ||
  '/Users/schwarz/Downloads/Thesis_Bewertung_Pradeep.pdf';

test('incremental sign with a sig image embeds an XObject and stays cryptoValid', async ({ page }) => {
  test.skip(!fs.existsSync(PRESIGNED_FIXTURE),
    `Set PDFSIGNER_PRESIGNED_FIXTURE to an Adobe-signed PDF to run this test.`);

  await page.evaluate(async () => {
    // Identity.
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

    // Synthetic signature "image": a 240x80 PNG with a scribble.
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15, 55); ctx.bezierCurveTo(60, 10, 90, 90, 130, 45);
    ctx.bezierCurveTo(160, 15, 190, 70, 225, 30);
    ctx.stroke();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const pngU8 = new Uint8Array(await blob.arrayBuffer());

    await window.upsertIdentity({
      label: 'Test', p12U8,
      meta: { name: 'Prof. Klaus Schwarz', email: 'schwarz@example.edu' },
      sigImagePngU8: pngU8,
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

  if (process.env.PDFSIGNER_KEEP_OUTPUT) {
    const p = PRESIGNED_FIXTURE.replace(/\.pdf$/i, '-preview-with-sig-image.pdf');
    fs.writeFileSync(p, outBytes);
    console.log('kept', p);
  }

  const verify = await page.evaluate(async ({ b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const results = window.verifyPdfSignatures(u8);
    const text = new TextDecoder('latin1').decode(u8);
    return {
      count: results.length,
      results: results.map(r => ({ cn: r.cn, cryptoValid: r.cryptoValid, error: r.error })),
      hasImageXObject: /\/Subtype\s*\/Image[\s\S]*?\/Filter\s*\/DCTDecode/.test(text),
      hasSigImgRef: /\/SigImg\s+\d+\s+0\s+R/.test(text),
      hasSigImgDo: /\/SigImg\s+Do/.test(text),
    };
  }, { b64: Buffer.from(outBytes).toString('base64') });

  console.log('VERIFY:', JSON.stringify(verify, null, 2));
  expect(verify.count).toBeGreaterThanOrEqual(2);
  for (const r of verify.results) {
    expect(r.error, `error ${r.error}`).toBeFalsy();
    expect(r.cryptoValid, `cn=${r.cn}`).toBe(true);
  }
  expect(verify.hasImageXObject, 'JPEG-encoded Image XObject in output').toBe(true);
  expect(verify.hasSigImgRef,  '/SigImg N 0 R reference').toBe(true);
  expect(verify.hasSigImgDo,   '/SigImg Do in content stream').toBe(true);
});
