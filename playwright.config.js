'use strict';
// End-to-end tests run the real app in a headless browser — the layer the
// node --test unit suite can't reach (rendering, the embedded preview, the
// donor-wall layout, and "does the console actually load without hanging").
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // A loopback-only static server keeps browser tests independent of Python.
  webServer: {
    command: 'node scripts/serve-static.cjs',
    url: 'http://127.0.0.1:8080/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
