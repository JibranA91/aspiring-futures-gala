'use strict';
// End-to-end tests run the real app in a headless browser — the layer the
// node --test unit suite can't reach (rendering, the embedded preview, the
// donor-wall layout, and "does the console actually load without hanging").
const { defineConfig } = require('@playwright/test');

// serve.py needs `python` on Windows and `python3` on Linux/macOS (and CI).
const PY = process.platform === 'win32' ? 'python' : 'python3';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // Serve gala/ with the project's own no-cache server for the duration of the run.
  webServer: {
    command: `${PY} serve.py 8080`,
    url: 'http://localhost:8080/',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
