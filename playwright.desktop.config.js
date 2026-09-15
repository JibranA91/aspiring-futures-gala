'use strict';
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './desktop-e2e', timeout: 60000, expect: { timeout: 15000 }, workers: 1,
  fullyParallel: false, forbidOnly: !!process.env.CI, retries: 0,
  outputDir: 'desktop-test-results', reporter: 'list',
  use: { trace: 'retain-on-failure', viewport: { width: 1280, height: 720 } }
});
