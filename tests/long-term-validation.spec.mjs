import { test, expect } from './fixtures.mjs';

test('preserves prior DSS evidence and signed bytes when adding a signature', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = PDFLib;
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 300]);
    const { p12Der, meta } = await generateIdentity({ name: 'LTV test', email: 'test@example.test', password: 'synthetic-password' });
    const { cert, key } = unlockP12(p12Der, 'synthetic-password');
    const chain = [cert, cert];
    const placement = { type: 'digital', pageIndex: 0, xPdf: 40, yPdf: 35, wPdf: 170, hPdf: 55, appearance: 'text' };
    window.collectOcspEvidence = async () => new Uint8Array([1, 2]);
    const first = await makeSignedPdf({
      bytes: await pdf.save(), cert, key, meta, chain,
      placements: [placement], signingTime: new Date('2026-01-01T00:00:00Z'),
    });
    const firstDoc = await PDFDocument.load(first);
    const oldDss = firstDoc.catalog.lookup(PDFName.of('DSS'));
    window.collectOcspEvidence = async () => new Uint8Array([3, 4]);
    const second = await makeIncrementalSignedPdf({
      bytes: first, cert, key, meta, chain,
      placements: [{ ...placement, xPdf: 220 }], signingTime: new Date('2026-01-01T00:01:00Z'),
    });
    const secondDoc = await PDFDocument.load(second);
    const newDss = secondDoc.catalog.lookup(PDFName.of('DSS'));
    const name = PDFName.of('OCSPs');
    const preserved = oldDss.lookup(name).get(0).toString() === newDss.lookup(name).get(0).toString();
    const ocsp = newDss.lookup(name).asArray().map(ref =>
      [...decodePDFRawStream(secondDoc.context.lookup(ref)).decode()]);
    const signatures = await verifyDocumentSignatures(second);
    return {
      prefixPreserved: first.every((byte, index) => byte === second[index]),
      signatures: signatures.map(item => item.cryptoValid),
      preserved,
      ocsp,
    };
  });
  expect(result).toEqual({
    prefixPreserved: true,
    signatures: [true, true],
    preserved: true,
    ocsp: [[1, 2], [3, 4]],
  });
});

test('embeds a token from the live default timestamp relay in a signed PDF', async ({ page }) => {
  test.skip(process.env.PDFSIGNER_TEST_LIVE_TSA !== '1', 'Set PDFSIGNER_TEST_LIVE_TSA=1 to use the default public TSA.');
  const result = await page.evaluate(async () => {
    const pdf = await PDFLib.PDFDocument.create();
    pdf.addPage([400, 300]);
    const generated = await generateIdentity({ name: 'Timestamp test', email: 'test@example.test', password: 'synthetic-password' });
    const { cert, key } = unlockP12(generated.p12Der, 'synthetic-password');
    const tsaUrl = document.getElementById('tsaUrl').value;
    const signed = await makeSignedPdf({
      bytes: await pdf.save(), cert, key, meta: generated.meta, tsaUrl,
      placements: [{ type: 'digital', pageIndex: 0, xPdf: 40, yPdf: 35, wPdf: 170, hPdf: 55, appearance: 'text' }],
    });
    const [signature] = await verifyDocumentSignatures(signed);
    return { valid: signature?.cryptoValid, imprintMatches: signature?.tsaOk, authority: signature?.tsaSubject };
  });
  expect(result.valid).toBe(true);
  expect(result.imprintMatches).toBe(true);
  expect(result.authority).toBeTruthy();
});
