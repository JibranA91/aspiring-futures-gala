'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let application, controller, directory;
async function start() {
  application = await electron.launch({ args: [path.resolve('.'), '--test-mode', '--test-data=' + directory] });
  controller = await application.firstWindow();
  await expect(controller.getByText('New gift', { exact: true })).toBeVisible();
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.server))).toBe('running');
}
test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-desktop-'));
  await start();
});
test.afterEach(async () => {
  await application?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('portable controller and offline projector survive gifts, branding, a server crash and an app restart', async ({ browser }) => {
  const externalRequests = [];
  const viewerContext = await browser.newContext();
  await viewerContext.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') { externalRequests.push(url.href); return route.abort(); }
    return route.continue();
  });
  const viewer = await viewerContext.newPage();
  await viewer.goto('http://127.0.0.1:8080/audience.html');
  const code = await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.code));
  await viewer.getByPlaceholder('1234').fill(code);
  await viewer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(viewer.getByText('Our Fundraising Evening', { exact: true })).toBeVisible();

  await controller.getByPlaceholder('e.g. The Rahman Family').fill('Offline Test Donor');
  await controller.getByPlaceholder('0', { exact: true }).fill('250');
  await controller.getByRole('button', { name: 'Add & show on screen' }).click();
  await expect(viewer.getByText('Offline Test Donor').first()).toBeVisible();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations.length).toBe(1);

  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByLabel('Organization name', { exact: true }).fill('Community Partners');
  await controller.getByRole('button', { name: 'Ocean', exact: true }).click();
  await controller.getByRole('combobox', { name: 'Event currency', exact: true }).selectOption('GBP');
  await expect(viewer.getByText('£250', { exact: true })).toHaveCount(0);
  await controller.getByRole('button', { name: 'Apply appearance', exact: true }).click();
  await expect.poll(() => viewer.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())).toBe('#47c4f1');
  await expect(viewer.getByText('£250', { exact: true }).first()).toBeVisible();
  await expect.poll(() => viewer.locator('[data-count="money"]').first().textContent()).toBe('£250');

  await controller.getByRole('button', { name: 'Restart server', exact: true }).click();
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.viewers))).toBe(1);
  expect(await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.code))).toBe(code);

  await application.evaluate(({ app }) => {
    // Exercise the same operating-system failure as an unexpected worker exit.
    const metric = app.getAppMetrics().find(item => item.name === 'Projector connection');
    if (!metric) throw new Error('Connection worker not found');
    process.kill(metric.pid);
  });
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.server))).toBe('running');
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.viewers))).toBe(1);
  await expect(viewer.getByText('Offline Test Donor').first()).toBeVisible();
  expect(externalRequests).toEqual([]);
  await controller.screenshot({ path: path.join('desktop-test-results', 'branding-settings.png'), fullPage: true });
  await viewer.screenshot({ path: path.join('desktop-test-results', 'audience.png') });
  await viewerContext.close();
  await application.close();
  await start();
  await expect(controller.getByText('Offline Test Donor').first()).toBeVisible();
  const restored = await controller.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')));
  expect(restored.donations).toHaveLength(1);
  expect(restored.branding.organization).toBe('Community Partners');
});

test('audience windows cannot access native controller controls and saved legacy events migrate intact', async () => {
  await application.close();
  const gift = { id: 'legacy-gift', ts: '2026-01-01T00:00:00Z', name: 'Legacy Donor', amount: 1000, status: 'pledged', collector: 'Private collector' };
  fs.writeFileSync(path.join(directory, 'events/event.json'), JSON.stringify({ eventName: 'Existing Gala', goal: 30000, donations: [gift] }));
  await start();
  await expect(controller.getByText('Legacy Donor').first()).toBeVisible();
  await controller.evaluate(() => window.fundraiserDesktop.openAudience());
  await expect.poll(() => application.windows().length).toBe(2);
  const audience = application.windows().find(page => page !== controller);
  expect(await audience.evaluate(() => typeof window.fundraiserDesktop)).toBe('undefined');
  const state = await controller.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')));
  expect(state.donations[0].id).toBe('legacy-gift');
  expect(state.donations[0].ts).toBe(gift.ts);
  expect(state.donations[0].fields.collector).toBe('Private collector');
  expect(state.goal).toBe(30000);
});

async function addGift(name, amount = '250') {
  await controller.getByPlaceholder('e.g. The Rahman Family').fill(name);
  await controller.getByPlaceholder('0', { exact: true }).fill(amount);
  await controller.getByRole('button', { name: 'Add & show on screen' }).click();
}

test('anonymous wording reaches a paired projector without exposing the recorded donor name', async ({ browser }) => {
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByLabel('Organization name', { exact: true }).fill('Community Partners');
  await controller.getByRole('button', { name: 'Apply appearance', exact: true }).click();
  await controller.getByLabel('Anonymous donor wording', { exact: true }).fill('Friends of {organization name}');
  await controller.getByRole('button', { name: 'Done', exact: true }).click();
  const viewer = await pairViewer(browser);
  await controller.getByRole('button', { name: 'Hold gift on screen', exact: true }).click();
  await controller.getByRole('button', { name: 'Anonymous', exact: true }).click();
  await addGift('Confidential donor');
  await expect(viewer.getByText('Friends of Community Partners', { exact: true })).toHaveCount(2);
  await expect(viewer.getByText('Confidential donor', { exact: true })).toHaveCount(0);
  const shared = await viewer.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')));
  expect(shared.anonymousLabel).toBe('Friends of {organization name}');
  expect(shared.donations[0].name).toBe('');
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations[0].name).toBe('Confidential donor');
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByLabel('Anonymous donor wording', { exact: true }).fill('A generous friend');
  await expect(viewer.getByText('A generous friend', { exact: true })).toHaveCount(2);
  await viewer.context().close();
  await application.close();
  await start();
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(controller.getByLabel('Anonymous donor wording', { exact: true })).toHaveValue('A generous friend');
});

test('virtual adapters stay in diagnostics, not projector links or the copied address', async () => {
  const reportPath = path.join(directory, 'connection-report.json');
  await application.evaluate(({ dialog }, reportPath) => {
    const address = value => ({ family: 'IPv4', internal: false, address: value });
    process.getBuiltinModule('os').networkInterfaces = () => ({
      'vEthernet (WSL (Hyper-V firewall))': [address('172.25.64.1')],
      'Wi-Fi': [address('10.0.0.156')]
    });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: reportPath });
  }, reportPath);
  const expected = 'http://10.0.0.156:8080/audience.html';
  expect(await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.urls))).toEqual([expected]);
  await controller.evaluate(() => window.fundraiserDesktop.copyLink());
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected);
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(controller.locator('.af-settings-address')).toHaveText([expected]);
  await controller.getByRole('button', { name: 'Save diagnostic report', exact: true }).click();
  await expect.poll(() => fs.existsSync(reportPath)).toBe(true);
  const report = JSON.parse(fs.readFileSync(reportPath));
  expect(report.network.adapters).toContainEqual({ name: 'vEthernet (WSL (Hyper-V firewall))', address: '172.25.64.1', kind: 'virtual' });
  expect(report.network.urls).toEqual([expected]);
  await application.evaluate(() => {
    process.getBuiltinModule('os').networkInterfaces = () => ({
      'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.25.64.1' }]
    });
  });
  expect(await controller.evaluate(() => window.fundraiserDesktop.copyLink())).toBe('');
  await expect(controller.locator('.af-settings-address')).toHaveCount(0);
  await expect(controller.getByText('No local address found. Connect to Wi-Fi, then check here again.', { exact: true })).toBeVisible();
});

test('settings put connection and projector side by side above a full-width backup at laptop sizes', async () => {
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = controller.getByRole('dialog', { name: 'Settings', exact: true });
  const connection = settings.getByRole('region', { name: 'Connection & Recovery', exact: true });
  const projector = settings.getByRole('region', { name: 'The Projector Laptop', exact: true });
  const backup = settings.getByRole('region', { name: 'Backup', exact: true });
  for (const width of [1440, 900]) {
    await application.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html')).setContentSize(width, 800);
    }, width);
    await expect.poll(() => controller.evaluate(() => innerWidth)).toBe(width);
    await expect(connection).toBeVisible();
    await expect(projector).toBeVisible();
    await expect(backup).toBeVisible();
    const left = await connection.boundingBox(), right = await projector.boundingBox(), below = await backup.boundingBox();
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    expect(left.x + left.width).toBeLessThan(right.x);
    expect(below.y).toBeGreaterThanOrEqual(Math.max(left.y + left.height, right.y + right.height));
    expect(Math.abs(below.x - left.x)).toBeLessThan(2);
    expect(Math.abs(below.x + below.width - right.x - right.width)).toBeLessThan(2);
    expect(await settings.locator('.af-settings-grid > *').evaluateAll(elements => elements.slice(0, 3).map(el =>
      el.querySelector('h2')?.textContent))).toEqual(['Connection & Recovery', 'Backup', 'Brand & appearance']);
    for (const card of [connection, projector, backup]) {
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await card.locator('h2').evaluate(el => getComputedStyle(el).fontSize)).toBe('20px');
      for (const button of await card.getByRole('button').all()) {
        const box = await button.boundingBox(), bounds = await card.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      }
    }
    await controller.screenshot({ path: path.join('desktop-test-results', 'settings-' + width + '.png') });
  }
  await projector.getByRole('button', { name: 'This laptop', exact: true }).click();
  await expect(projector.getByRole('button', { name: 'Open audience window', exact: true })).toBeVisible();
  await projector.getByRole('button', { name: 'Second laptop', exact: true }).click();
  await expect(projector.getByRole('button', { name: 'New code', exact: true })).toBeVisible();
  await expect(backup.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await addGift('After settings layout');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations.length).toBe(1);
});
async function pairViewer(browser, stale = false) {
  const viewer = await browser.newPage();
  if (stale) await viewer.addInitScript(() => localStorage.setItem('af-gala-state-v1', JSON.stringify({ rev: Date.now() + 1e12, eventName: 'Stale unrelated event', donations: [] })));
  await viewer.goto('http://127.0.0.1:8080/audience.html');
  const code = await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.code));
  await viewer.getByPlaceholder('1234').fill(code);
  await viewer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(viewer.getByText('Our Fundraising Evening', { exact: true })).toBeVisible();
  return viewer;
}

test('failed saves remain visible, export works, and pending gifts recover when the app reopens', async () => {
  const blocked = path.join(directory, 'events/event.json.tmp');
  fs.mkdirSync(blocked);
  await addGift('Unsaved recovery donor');
  await expect(controller.getByText('Save failed — export a backup', { exact: false }).first()).toBeVisible();
  const exported = path.join(directory, 'emergency-export.json');
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exported);
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByRole('button', { name: 'Export event', exact: true }).click();
  await expect.poll(() => fs.existsSync(exported)).toBe(true);
  expect(JSON.parse(fs.readFileSync(exported)).donations[0].name).toBe('Unsaved recovery donor');
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations).toHaveLength(0);
  await application.close();
  fs.rmdirSync(blocked);
  await start();
  await expect(controller.getByText('Unsaved recovery donor', { exact: true }).first()).toBeVisible();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(directory, 'events/event.json'))).donations.length).toBe(1);
});

test('two projectors catch up after a connection interruption and replace stale cached events', async ({ browser }) => {
  const first = await pairViewer(browser, true), second = await pairViewer(browser);
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.viewers))).toBe(2);
  await addGift('Before disconnect');
  await expect(first.getByText('Before disconnect').first()).toBeVisible();
  await first.context().setOffline(true);
  for (let i = 0; i < 8; i++) await addGift('Queued gift ' + i, '100');
  await expect(second.getByText('Queued gift 7').first()).toBeVisible();
  await first.context().setOffline(false);
  await expect(first.getByText('Queued gift 7').first()).toBeVisible();
  await expect.poll(() => first.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')).donations.length)).toBe(9);
  expect(await first.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')).donations.reduce((sum, gift) => sum + gift.amount, 0))).toBe(1050);
  await first.context().close(); await second.context().close();
});

test('changing the code revokes old projector sessions and the new code reconnects', async ({ browser }) => {
  const viewer = await pairViewer(browser);
  const code = await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.code));
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByRole('button', { name: 'New code', exact: true }).click();
  await expect(viewer.getByText('That code does not match. Check the controller.', { exact: true })).toBeVisible();
  const next = await controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.code));
  expect(next).not.toBe(code);
  await viewer.getByPlaceholder('1234').fill(next);
  await viewer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => controller.evaluate(() => window.fundraiserDesktop.status().then(value => value.viewers))).toBe(1);
  await viewer.context().close();
});

test('import and export preserve private fields, IDs, timestamps, branding, and archive the prior event', async () => {
  await addGift('Prior event donor');
  const imported = { eventName: 'Imported event', goal: 45000, branding: { organization: 'Animal shelter', currency: 'CAD' },
    donations: [{ id: 'original-id', ts: '2025-06-01T12:30:00Z', name: 'Imported donor', amount: 345, fields: { privateNote: 'retain this' }, anon: true }] };
  const source = path.join(directory, 'import.json'), exported = path.join(directory, 'export.json');
  fs.writeFileSync(source, JSON.stringify(imported));
  await application.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.source] });
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.exported });
  }, { source, exported });
  await controller.getByRole('button', { name: 'Settings', exact: true }).click();
  await controller.getByRole('button', { name: 'Import event', exact: true }).click();
  await expect(controller.getByText('Event imported. Your previous event was archived.', { exact: true })).toBeVisible();
  await controller.getByRole('button', { name: 'Export event', exact: true }).click();
  await expect.poll(() => fs.existsSync(exported)).toBe(true);
  const result = JSON.parse(fs.readFileSync(exported));
  expect(result.donations).toEqual(imported.donations);
  expect(result.branding).toEqual(imported.branding);
  const archives = fs.readdirSync(path.join(directory, 'events')).filter(name => name.startsWith('event-'));
  expect(archives.length).toBeGreaterThan(0);
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'events', archives[0]))).donations[0].name).toBe('Prior event donor');
});
