import { test, expect, createIdentity, makeFixturePdf, dropPdf } from './fixtures.mjs';

test('sign a fixture PDF and download it', async ({ page }) => {
  await createIdentity(page);
  const bytes = await makeFixturePdf(['Thesis review report — signed here.', 'Grade: 1.3', 'Comments: excellent work.']);
  await dropPdf(page, bytes, 'review.pdf');
  await expect(page.locator('.page-wrap')).toHaveCount(1);

  // Arm the signature tool and drop a placement inside the visible viewport.
  // The page-wrap can be taller than the viewport (portrait A4 fit-to-width),
  // so click near the top-right instead of the bottom-right to guarantee the
  // click lands on the wrap without needing to scroll.
  await page.click('#btnPlaceSig');
  const wrap = page.locator('.page-wrap').first();
  const box = await wrap.boundingBox();
  await page.mouse.click(box.x + box.width - 150, box.y + 120);
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
  // We now emit /ETSI.CAdES.detached (PAdES-B-B baseline) on fresh signs;
  // adbe.pkcs7.detached is still accepted on the incremental path.
  expect(text).toMatch(/ETSI\.CAdES\.detached|adbe\.pkcs7\.detached/);
});
