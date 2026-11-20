import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { test, expect, createIdentity, dropPdf } from './fixtures.mjs';

async function makeSharedForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form.createTextField('First reviewer').addToPage(page, { x: 40, y: 710, width: 200 });
  form.createTextField('Second reviewer').addToPage(page, { x: 40, y: 660, width: 200 });

  for (const [name, y] of [['First signature', 550], ['Second signature', 470]]) {
    const field = pdf.context.obj({ FT: 'Sig', T: PDFString.of(name), Kids: [] });
    const fieldRef = pdf.context.register(field);
    const widget = pdf.context.obj({
      Type: 'Annot', Subtype: 'Widget', Rect: [40, y, 240, y + 50],
      Parent: fieldRef, P: page.ref, F: 4,
    });
    const widgetRef = pdf.context.register(widget);
    field.get(PDFName.of('Kids')).push(widgetRef);
    form.acroForm.addField(fieldRef);
    page.node.addAnnot(widgetRef);
  }
  pdf.catalog.set(PDFName.of('Version'), PDFName.of('1.4'));
  return pdf.save();
}

async function downloadSigned(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { predicate: d => d.suggestedFilename().endsWith('-signed.pdf') }),
    page.locator('#btnSign').click(),
  ]);
  return readFile(await download.path());
}

for (const permission of [null, 2, 3]) {
  const mode = permission ? 'certify' : 'void';
  test(`keep form fields and earlier signatures through two signing rounds (permission ${permission})`, async ({ page }) => {
    await createIdentity(page);
    await dropPdf(page, await makeSharedForm(), 'review.pdf');
    await page.locator(`input[name="lockmode"][value="${mode}"]`).evaluate(el => el.click());
    if (permission) await page.locator('#certifyPermission').selectOption(String(permission));
    await page.locator('#fieldLockOptions summary').click();
    await page.locator('#fieldLockList').getByLabel('First reviewer', { exact: true }).check();
    await page.locator('[title="PDF form field: First reviewer"]').fill('First review');
    await page.locator('.field-hint[title*="First signature"]').click();
    const first = await downloadSigned(page);

    const firstPdf = await PDFDocument.load(first);
    expect(firstPdf.getForm().getTextField('First reviewer').getText()).toBe('First review');
    expect(firstPdf.getForm().getTextField('Second reviewer').isReadOnly()).toBe(false);
    expect(firstPdf.getForm().getSignature('First signature').acroField.dict.has(PDFName.of('V'))).toBe(true);
    expect(firstPdf.getForm().getSignature('Second signature').acroField.dict.has(PDFName.of('V'))).toBe(false);
    const firstField = firstPdf.getForm().getSignature('First signature').acroField.dict;
    const lock = firstField.lookup(PDFName.of('Lock'));
    expect(String(lock.get(PDFName.of('Action')))).toBe('/Include');
    expect(lock.lookup(PDFName.of('Fields')).get(0).decodeText()).toBe('First reviewer');
    const permissions = firstPdf.catalog.lookup(PDFName.of('Perms'));
    if (permission) {
      const certification = permissions.lookup(PDFName.of('DocMDP'));
      const params = certification.lookup(PDFName.of('Reference')).lookup(0).lookup(PDFName.of('TransformParams'));
      expect(params.lookup(PDFName.of('P')).asNumber()).toBe(permission);
    } else {
      expect(permissions).toBeUndefined();
    }

    await dropPdf(page, first, 'review-round-one.pdf');
    await expect(page.locator('[title="PDF form field: First reviewer"]')).toHaveCount(0);
    await page.locator('[title="PDF form field: Second reviewer"]').fill('Second review');
    await page.locator('.field-hint[title*="Second signature"]').click();
    await page.locator('input[name="lockmode"][value="locked"]').evaluate(el => el.click());
    const second = await downloadSigned(page);

    expect(second.subarray(0, first.length).equals(first)).toBe(true);
    const secondPdf = await PDFDocument.load(second);
    expect(secondPdf.getForm().getTextField('Second reviewer').getText()).toBe('Second review');
    const finalField = secondPdf.getForm().getSignature('Second signature').acroField.dict;
    expect(finalField.has(PDFName.of('V'))).toBe(true);
    expect(String(finalField.lookup(PDFName.of('Lock')).get(PDFName.of('Action')))).toBe('/All');

    await dropPdf(page, second, 'review-final.pdf');
    await expect(page.locator('#btnSign')).toHaveText('Document locked by a signature');
    const signatures = await page.evaluate(() => verifyPdfSignatures(doc.bytes).map(r => r.cryptoValid));
    expect(signatures).toEqual([true, true]);
  });
}

test('lock an unsigned form with the first signature', async ({ page }) => {
  await createIdentity(page);
  await dropPdf(page, await makeSharedForm(), 'final-review.pdf');
  await page.locator('[title="PDF form field: First reviewer"]').fill('Final review');
  await page.locator('.field-hint[title*="First signature"]').click();
  await page.locator('input[name="lockmode"][value="locked"]').evaluate(el => el.click());
  const signed = await downloadSigned(page);

  await dropPdf(page, signed, 'locked-review.pdf');
  await expect(page.locator('#btnSign')).toHaveText('Document locked by a signature');
  await expect(page.locator('[title="PDF form field: Second reviewer"]')).toHaveCount(0);
  expect(await page.evaluate(() => verifyPdfSignatures(doc.bytes).map(r => r.cryptoValid))).toEqual([true]);
});
