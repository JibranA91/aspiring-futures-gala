'use strict';
const { test, expect } = require('@playwright/test');

const STATE_KEY = 'af-gala-state-v1';

// A realistic saved board: `count` donors (one Pledged so a meta line renders),
// with the field definitions the audience needs to show meta.
function seedState(count) {
  const fields = [
    { id: 'status', label: 'Status', type: 'choice', options: ['Paid', 'Pledged'], onScreen: true, wide: true },
    { id: 'table', label: 'Table / seat', type: 'text', onScreen: true },
    { id: 'place', label: 'City or country', type: 'text', onScreen: true, wide: true },
  ];
  const donations = [];
  for (let i = 0; i < count; i++) {
    donations.push({
      id: 'x' + i,
      ts: new Date(Date.now() - i * 60000).toISOString(),
      name: 'Donor Family ' + (i + 1),
      anon: false,
      amount: 500 + i * 100,
      fields: { status: i === 3 ? 'Pledged' : 'Paid' },
      voided: false,
    });
  }
  return { goal: 500000, showGoal: true, showTotal: true, fields, donations, rev: Date.now() };
}

// Preload a saved board into localStorage before the app's scripts run.
async function seed(page, count) {
  await page.addInitScript((state) => {
    try { localStorage.setItem('af-gala-state-v1', JSON.stringify(state)); } catch (e) {}
  }, seedState(count));
}

test.describe('Gala Control console', () => {
  test('loads and renders without hanging (regression: the frozen preview)', async ({ page }) => {
    // Seed >4 donors so the embedded preview (fixed at 4 rows) has surplus
    // candidates — that surplus is exactly what triggered the freeze.
    await seed(page, 16);
    await page.goto('/');
    // A blocked main thread (the infinite-loop freeze) means these never appear.
    await expect(page.getByText('New gift')).toBeVisible();
    await expect(page.getByText('Audience preview')).toBeVisible();
    // The embedded preview iframe must boot its board too — that iframe was the freeze.
    const preview = page.frameLocator('iframe[title="Audience preview"]');
    await expect(preview.getByText('An Evening for Aspiring Futures')).toBeVisible();
  });

  test('adding a gift updates the total and the log', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('New gift')).toBeVisible();
    await page.getByPlaceholder('e.g. The Rahman Family').fill('The Ahmed Family');
    await page.getByPlaceholder('0', { exact: true }).fill('2500');
    await page.getByRole('button', { name: 'Add & show on screen' }).click();
    await expect(page.getByText('The Ahmed Family').first()).toBeVisible();
    await expect(page.getByText('$2,500').first()).toBeVisible();
  });

  test('a logged gift can be edited and voided from the dialog', async ({ page }) => {
    await seed(page, 2);
    await page.goto('/');
    await expect(page.getByText('New gift')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByText('Edit gift')).toBeVisible();
    await page.getByRole('button', { name: 'Void this gift' }).click();
    await expect(page.getByRole('button', { name: /Voided/ })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Edit gift')).toBeHidden();
    await expect(page.getByText(/VOIDED/)).toBeVisible();
  });

  test('the Celebrate panel plays a burst on the preview', async ({ page }) => {
    await page.goto('/');
    const preview = page.frameLocator('iframe[title="Audience preview"]');
    await expect(preview.getByText('An Evening for Aspiring Futures')).toBeVisible();
    await page.getByRole('button', { name: /Balloons/ }).click();
    await expect(preview.locator('canvas')).toBeAttached();
  });
});

test.describe('Audience donor wall', () => {
  test('auto-fits to the panel: fills the space, last row not clipped', async ({ page }) => {
    await seed(page, 16);
    await page.goto('/audience.html#local=1');
    await expect(page.getByText("Tonight's donors")).toBeVisible();

    // The fit settles a couple of frames after load — wait for it to exceed the old cap.
    const rowCount = () => page.evaluate(() => {
      const title = [...document.querySelectorAll('div')].find(
        (d) => d.textContent.trim() === "Tonight's donors" && d.children.length === 0);
      return title ? title.nextElementSibling.children.length : 0;
    });
    await expect.poll(rowCount, { timeout: 10000 }).toBeGreaterThan(7); // more than the old hard cap

    const m = await page.evaluate(() => {
      const title = [...document.querySelectorAll('div')].find(
        (d) => d.textContent.trim() === "Tonight's donors" && d.children.length === 0);
      const box = title.nextElementSibling;
      const kids = [...box.children];
      const last = kids[kids.length - 1];
      return { avail: box.clientHeight, lastBottom: last.offsetTop + last.offsetHeight };
    });
    expect(m.lastBottom).toBeLessThanOrEqual(m.avail + 1);        // never clips the last row
    expect(m.avail - m.lastBottom).toBeLessThan(70);              // genuinely fills (< one row of slack)
  });
});
