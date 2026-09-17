import { test, expect } from './fixtures.mjs';

test('app boots without console errors and shows the empty state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#emptyState h3')).toHaveText(/Open, sign or verify a PDF/);
  // pdf.js and pdf-lib namespaces should be live.
  expect(await page.evaluate(() => typeof pdfjsLib !== 'undefined')).toBe(true);
  expect(await page.evaluate(() => typeof PDFLib !== 'undefined')).toBe(true);
  // No unexpected console errors during boot (allow the standardFontDataUrl warning from pdf.js).
  const fatal = errors.filter(e => !/standardFontDataUrl/i.test(e) && !/favicon/i.test(e));
  expect(fatal).toEqual([]);
});
