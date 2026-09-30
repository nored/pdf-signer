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
    launchOptions: {
      args: [
        '--disable-web-security',
        // Chromium's password manager remembers the p12 password entered by
        // one test and autofills it into the wrong field on subsequent tests,
        // clobbering the identity-creation form. Disable the whole stack.
        '--disable-features=AutofillServerCommunication,PasswordManagerOnboarding,ImprovedPasswordChangeService,PasswordLeakToggleMove,AutofillEnableAccountWalletStorage',
        '--disable-save-password-bubble',
      ],
    },
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
});
