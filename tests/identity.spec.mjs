import { test, expect } from './fixtures.mjs';
import { createIdentity } from './fixtures.mjs';

test('create a new identity, see it in the sidebar', async ({ page }) => {
  await createIdentity(page, { label: 'Thesis grading', name: 'Prof. Ada Lovelace', email: 'ada@example.edu' });
  await expect(page.locator('#idText')).toHaveText(/Ready/);
  await expect(page.locator('#idName')).toContainText('Thesis grading');
  await expect(page.locator('#idName')).toContainText('Prof. Ada Lovelace');
  await expect(page.locator('#idEmail')).toHaveText('ada@example.edu');
});
