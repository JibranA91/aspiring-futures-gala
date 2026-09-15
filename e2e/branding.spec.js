'use strict';
const { test, expect } = require('@playwright/test');

test('anonymous wording updates the wall and announcement, follows applied branding, and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hold gift on screen', exact: true }).click();
  await page.getByPlaceholder('e.g. The Rahman Family').fill('Confidential donor');
  await page.getByRole('button', { name: 'Anonymous', exact: true }).click();
  await page.getByPlaceholder('0', { exact: true }).fill('250');
  await page.getByRole('button', { name: 'Add & show on screen', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Audience preview"]');
  await expect(preview.getByText('A friend of Aspiring Futures', { exact: true })).toHaveCount(2);
  await expect(preview.getByText('Confidential donor', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const wording = page.getByLabel('Anonymous donor wording', { exact: true });
  await expect(wording).toHaveValue('A friend of {organization name}');
  await page.getByLabel('Organization name', { exact: true }).fill('Community Partners');
  await expect(preview.getByText('A friend of Aspiring Futures', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Apply appearance', exact: true }).click();
  await expect(preview.getByText('A friend of Community Partners', { exact: true })).toHaveCount(2);
  await wording.fill('<b>A generous friend</b>');
  await expect(preview.getByText('<b>A generous friend</b>', { exact: true })).toHaveCount(2);
  await expect(preview.locator('b').filter({ hasText: 'A generous friend' })).toHaveCount(0);
  await wording.fill('A generous friend');
  await expect(preview.getByText('A generous friend', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(preview.getByText('A generous friend', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(wording).toHaveValue('A generous friend');
  await wording.fill('');
  await expect(preview.getByText('A friend of Community Partners', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Use default wording', exact: true }).click();
  await expect(wording).toHaveValue('A friend of {organization name}');
});

test('appearance drafts stay off the live screen, selects restore saved values, and logo uploads sync', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Type style' })).toHaveValue('rounded');
  const preview = page.frameLocator('iframe[title="Audience preview"]');
  await page.getByLabel('Organization name', { exact: true }).fill('Community Action');
  await page.getByRole('button', { name: 'Paper', exact: true }).click();
  await expect(preview.getByAltText('Aspiring Futures')).toBeVisible();
  await page.getByLabel('Logo (PNG, JPG, WebP)').setInputFiles('gala/assets/aspiring-futures-logo.jpg');
  await page.getByRole('combobox', { name: 'Event currency' }).selectOption('EUR');
  await page.getByRole('button', { name: 'Apply appearance' }).click();
  await expect(preview.getByAltText('Community Action')).toBeVisible();
  await expect.poll(() => preview.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--color-bg'))).toBe('#faf6ee');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Event currency' })).toHaveValue('EUR');
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveValue('Community Action');
  expect(errors).toEqual([]);
});

test('theme changes with a full donor wall never freeze the controller or clip its preview', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('af-gala-state-v1', JSON.stringify({ rev: 1, goal: 10000, donations: Array.from({ length: 60 }, (_, i) => ({
      id: 'gift-' + i, name: 'A donor with a long organization name ' + i, ts: new Date().toISOString(), amount: 100, fields: { status: 'Paid' }
    })) }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const preset of ['Paper', 'Ocean', 'Gala', 'Midnight']) {
    await page.getByRole('button', { name: preset, exact: true }).click();
    await page.getByRole('button', { name: 'Apply appearance' }).click();
  }
  await page.getByLabel('Show program impact calculations').uncheck();
  await page.getByRole('button', { name: 'Apply appearance' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('New gift', { exact: true })).toBeVisible();
  const preview = page.frameLocator('iframe[title="Audience preview"]');
  await expect(preview.getByText('supported for a full year', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('Tonight\'s donors', { exact: true })).toBeVisible();
});

test('a rejected logo file does not change the event or apply draft settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Logo (PNG, JPG, WebP)').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByText('Choose a PNG, JPG, or WebP image.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('af-gala-state-v1')).branding)).toBeUndefined();
});

test('program labels, costs and units stay editable and survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Program name', { exact: true }).first().fill('Community meals');
  await page.getByLabel('Program unit', { exact: true }).first().fill('families');
  await page.getByLabel('Cost / month', { exact: true }).first().fill('90');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Program name', { exact: true }).first()).toHaveValue('Community meals');
  await expect(page.getByLabel('Program unit', { exact: true }).first()).toHaveValue('families');
  await expect(page.getByLabel('Cost / month', { exact: true }).first()).toHaveValue('90');
});

test('browser settings keep projector and backup above appearance without empty connection space', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('region', { name: 'Connection & Recovery', exact: true })).toHaveCount(0);
  const projector = await settings.getByRole('region', { name: 'The Projector Laptop', exact: true }).boundingBox();
  const backup = await settings.getByRole('region', { name: 'Backup', exact: true }).boundingBox();
  expect(backup.y).toBeGreaterThanOrEqual(projector.y + projector.height);
  expect(Math.abs(backup.x - projector.x)).toBeLessThan(2);
  expect(Math.abs(backup.width - projector.width)).toBeLessThan(2);
  expect(await settings.locator('.af-settings-grid > *').evaluateAll(elements => elements.slice(0, 3).map(el =>
    el.querySelector('h2')?.textContent))).toEqual(['The Projector Laptop', 'Backup', 'Brand & appearance']);
  await expect(settings.getByRole('button', { name: 'Export event', exact: true })).toBeVisible();
});

test('screen wording fills the gap below programs and keeps its settings after a reload', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('af-gala-state-v1')) localStorage.setItem('af-gala-state-v1', JSON.stringify({
      rev: 1, donations: [], categories: [{ id: 'community', name: 'Community support', pct: 100, monthly: 50, unit: 'people' }]
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const programs = page.getByText('Where it goes', { exact: true }).locator('..').locator('..');
  const wording = page.getByText('Screen & wording', { exact: true }).locator('..');
  const fields = page.getByText('Gift fields', { exact: true }).locator('..');
  for (const width of [1280, 900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const top = await programs.boundingBox(), below = await wording.boundingBox(), right = await fields.boundingBox();
    expect(Math.abs(below.x - top.x)).toBeLessThan(2);
    expect(below.y - top.y - top.height).toBeGreaterThanOrEqual(19);
    expect(below.y - top.y - top.height).toBeLessThanOrEqual(21);
    if (width >= 900) {
      expect(right.x).toBeGreaterThan(top.x + top.width);
      expect(Math.abs(right.y - top.y)).toBeLessThan(2);
    } else {
      expect(right.y).toBeGreaterThanOrEqual(below.y + below.height);
    }
    await programs.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('settings-details-' + width + '.png') });
  }
  await wording.locator('input').first().fill('Updated evening');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(wording.locator('input').first()).toHaveValue('Updated evening');
});
