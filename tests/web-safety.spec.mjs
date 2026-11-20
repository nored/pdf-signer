import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import { test, expect, createIdentity, dropPdf } from './fixtures.mjs';

for (const rotation of [0, 90]) {
  test(`redaction preserves adjacent searchable text on a page rotated ${rotation}°`, async ({ page }) => {
    const source = await PDFDocument.create();
    const marker = 'PRIVATE REDACTION SAMPLE 7124';
    const sourcePage = source.addPage([400, 300]);
    sourcePage.setRotation(degrees(rotation));
    if (rotation) sourcePage.setCropBox(10, 20, 380, 260);
    const font = await source.embedFont(StandardFonts.Helvetica);
    const prefix = 'Keep the start';
    const suffix = 'Keep the end';
    const fontSize = 10;
    const markerX = 40 + font.widthOfTextAtSize(prefix + '   ', fontSize);
    const markerWidth = font.widthOfTextAtSize(marker, fontSize);
    sourcePage.drawText(`${prefix}   ${marker}   ${suffix}`, { x: 40, y: 200, size: fontSize, font });
    source.addPage([400, 300]).drawText('Unchanged second page', { x: 40, y: 200, font });
    sourcePage.drawRectangle({ x: 40, y: 140, width: 10, height: 10 });
    await source.attach(Buffer.from(marker), 'source.txt');
    await createIdentity(page);
    await dropPdf(page, await source.save(), 'redaction-sample.pdf');
    await page.evaluate(({ markerX, markerWidth }) => {
      doc.placements.push(
        { type: 'redact', pageIndex: 0, xPdf: markerX - 1, yPdf: 195, wPdf: markerWidth + 2, hPdf: 18 },
        { type: 'digital', pageIndex: 0, xPdf: 40, yPdf: 35, wPdf: 170, hPdf: 55, appearance: 'text' },
      );
      updateSignButton();
    }, { markerX, markerWidth });
    await page.locator('#btnSign').click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { predicate: d => d.suggestedFilename().endsWith('-signed.pdf') }),
      page.getByRole('button', { name: 'Redact and sign' }).click(),
    ]);
    const output = await readFile(await download.path());
    const parsed = await PDFDocument.load(output);
    const markerHex = Buffer.from(marker).toString('hex');
    expect(output.includes(marker)).toBe(false);
    for (const [, object] of parsed.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
      expect(decoded).not.toContain(marker);
      expect(decoded.toLowerCase()).not.toContain(markerHex);
    }

    await dropPdf(page, output, 'sanitized.pdf');
    const result = await page.evaluate(async markerX => {
      const signatures = await verifyDocumentSignatures(doc.bytes);
      const pdfPage = await doc.pdfjs.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      const extract = async n => (await (await doc.pdfjs.getPage(n)).getTextContent()).items
        .map(item => item.str).join(' ');
      const pixel = (x, y) => {
        const [px, py] = viewport.convertToViewportPoint(x, y);
        return [...context.getImageData(Math.floor(px), Math.floor(py), 1, 1).data];
      };
      return {
        signatures: signatures.map(signature => signature.cryptoValid),
        firstPageText: await extract(1),
        nextPageText: await extract(2),
        redactedPixel: pixel(markerX + 5, 200),
        untouchedPixel: pixel(45, 145),
        whitePixel: pixel(30, 250),
      };
    }, markerX);
    expect(result.firstPageText).toContain(prefix);
    expect(result.firstPageText).toContain(suffix);
    expect(result.firstPageText).not.toContain(marker);
    expect(result.nextPageText).toContain('Unchanged second page');
    expect(result).toMatchObject({
      signatures: [true],
      redactedPixel: [0, 0, 0, 255],
      untouchedPixel: [0, 0, 0, 255],
      whitePixel: [255, 255, 255, 255],
    });
  });
}

test('migrates existing vault credentials and signature images without storing plaintext', async ({ page }) => {
  await createIdentity(page);
  await page.evaluate(async () => {
    const records = await idbGet('identities');
    const record = Object.values(records)[0];
    record.ghVault = { owner: 'test-owner', repo: 'test-vault', branch: 'main', pathPrefix: 'vault', token: 'test-token' };
    record.sigImagePng = new Uint8Array([1, 2, 3]);
    await idbPut('identities', records);
  });
  await page.reload();
  await page.waitForFunction(() => window.pdfjsLib && typeof idbGet === 'function' && ghVault.config?.token === 'test-token');
  const result = await page.evaluate(async () => {
    const record = Object.values(await idbGet('identities'))[0];
    const key = await idbGet('identityStorageKey');
    return {
      encrypted: record.protectedData.ciphertext.byteLength > 0,
      hasPlainToken: 'ghVault' in record,
      hasPlainImage: 'sigImagePng' in record,
      extractable: key.extractable,
      restoredImage: [...sigImage.pngU8],
    };
  });
  expect(result).toEqual({
    encrypted: true,
    hasPlainToken: false,
    hasPlainImage: false,
    extractable: false,
    restoredImage: [1, 2, 3],
  });
  await page.locator('#idSettings').evaluate(details => { details.open = true; });
  await page.locator('#btnExportId').click();
  await expect(page.locator('#incTok')).toBeChecked();
  await page.locator('#incTok').uncheck();
  await expect(page.locator('#incTok')).not.toBeChecked();
});

test('a pending certificate upload keeps the document and vault bound to the signing request', async ({ page }) => {
  await createIdentity(page);
  const source = await PDFDocument.create();
  source.addPage([400, 300]).drawText('The first document', { x: 40, y: 240 });
  const other = await PDFDocument.create();
  other.addPage([400, 300]).drawText('The second document', { x: 40, y: 240 });
  await dropPdf(page, await source.save(), 'first.pdf');

  await page.evaluate(() => {
    // Pause an asynchronous boundary without sending credentials or test PDFs.
    window.auditPublishStarted = false;
    window.ensureCertPublishedToVault = () => new Promise(resolve => {
      window.finishAuditPublish = resolve;
      window.auditPublishStarted = true;
    });
    ghVault.config = { owner: 'test-owner', repo: 'test-vault', branch: 'main', pathPrefix: 'vault', token: 'test' };
    document.querySelector('input[name="vaultHost"][value="local"]').checked = true;
    document.getElementById('tsaEnable').checked = false;
    doc.placements.push({ type: 'digital', pageIndex: 0, xPdf: 40, yPdf: 35, wPdf: 270, hPdf: 60, appearance: 'stamp' });
    updateSignButton();
  });
  const signedDownload = page.waitForEvent('download', { predicate: d => d.suggestedFilename().endsWith('.pdf') });
  const vaultDownload = page.waitForEvent('download', { predicate: d => d.suggestedFilename().endsWith('.vault') });
  await page.locator('#btnSign').click();
  await page.waitForFunction(() => window.auditPublishStarted);
  await dropPdf(page, await other.save(), 'second.pdf');
  await page.evaluate(() => window.finishAuditPublish(null));
  const [signed, vault] = await Promise.all([signedDownload, vaultDownload]);
  expect(signed.suggestedFilename()).toBe('first-signed.pdf');
  expect(vault.suggestedFilename()).toBe('first.vault');

  const output = await readFile(await signed.path());
  const encrypted = await readFile(await vault.path());
  await dropPdf(page, output, 'downloaded.pdf');
  const result = await page.evaluate(async vaultBytes => {
    const pdfPage = await doc.pdfjs.getPage(1);
    const text = (await pdfPage.getTextContent()).items.map(item => item.str).join(' ');
    const link = (await pdfPage.getAnnotations()).find(annotation => annotation.url?.includes('#v='));
    const { keyBytes } = parseVaultQr(link.url);
    const plaintext = await aesGcmDecrypt(keyBytes, new Uint8Array(vaultBytes));
    return { text, vaultMatches: plaintext.length === doc.bytes.length && plaintext.every((byte, i) => byte === doc.bytes[i]) };
  }, [...encrypted]);
  expect(result.text).toContain('The first document');
  expect(result.text).not.toContain('The second document');
  expect(result.vaultMatches).toBe(true);
});
