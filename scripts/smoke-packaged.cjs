'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const executablePath = process.argv[2];
  if (!executablePath) throw new Error('Pass the path to the packaged executable.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-packaged-'));
  let app;
  try {
    app = await electron.launch({ executablePath, args: ['--data-dir=' + directory] });
    const page = await app.firstWindow();
    await expect(page.getByText('New gift', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.fundraiserDesktop.status().then(value => value.server))).toBe('running');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const name of ['Connection & Recovery', 'The Projector Laptop', 'Backup']) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByPlaceholder('e.g. The Rahman Family').fill('Packaged app check');
    await page.getByPlaceholder('0', { exact: true }).fill('50');
    await page.getByRole('button', { name: 'Add & show on screen' }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations.length).toBe(1);
    await expect(page.frameLocator('iframe[title="Audience preview"]').getByText('Packaged app check').first()).toBeVisible();
    console.log('Packaged app passed: controller, settings, local server, gift save, and audience preview.');
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
