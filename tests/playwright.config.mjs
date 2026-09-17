import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,       // avoid cross-test IndexedDB stomping
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    launchOptions: { args: ['--disable-web-security'] },
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
});
