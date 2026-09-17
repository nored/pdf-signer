import { test, expect, createIdentity, makeFixturePdf, dropPdf } from './fixtures.mjs';

test('sign a fixture PDF and download it', async ({ page }) => {
  await createIdentity(page);
  const bytes = await makeFixturePdf(['Thesis review report — signed here.', 'Grade: 1.3', 'Comments: excellent work.']);
  await dropPdf(page, bytes, 'review.pdf');
  await expect(page.locator('.page-wrap')).toHaveCount(1);

  // Arm the signature tool and drop a placement in a known corner.
  await page.click('#btnPlaceSig');
  const wrap = page.locator('.page-wrap').first();
  const box = await wrap.boundingBox();
  await page.mouse.click(box.x + box.width - 120, box.y + box.height - 80);
  // The sign button should now be enabled.
  await expect(page.locator('#btnSign')).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.click('#btnSign'),
  ]);
  const name = download.suggestedFilename();
  expect(name).toMatch(/-signed\.pdf$/);

  // Read the downloaded bytes and confirm they parse as a PDF with our signer.
  const path = await download.path();
  const fs = await import('fs/promises');
  const bytesOut = new Uint8Array(await fs.readFile(path));
  const text = new TextDecoder('latin1').decode(bytesOut);
  expect(text).toContain('/ByteRange');
  expect(text).toContain('adbe.pkcs7.detached');
});
