import { expect, test, type Page } from '@playwright/test';

/** Live events come first in the virtualized list; scroll until prematch rows are rendered. */
async function scrollToPrematch(page: Page) {
  const prematch = page.locator('.row[data-status="prematch"]');
  for (let i = 0; i < 40 && (await prematch.count()) < 3; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(100);
  }
  await expect(prematch.nth(2)).toBeVisible();
}

async function addSelections(page: Page, count: number) {
  // Prematch events: they do not end or suspend during the test.
  const rows = page.locator('.row[data-status="prematch"]');
  for (let i = 0; i < count; i++) {
    await rows.nth(i).locator('button.odds:not([disabled])').first().click();
  }
  await expect(page.locator('.leg')).toHaveCount(count);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?sport=1');
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
  await page.getByRole('button', { name: 'reset' }).click();
  await expect(page.locator('.balance')).toContainText('1,000.00');
  await scrollToPrematch(page);
});

test('places a single bet and updates the balance', async ({ page }) => {
  await addSelections(page, 1);
  await page.getByRole('button', { name: 'Any' }).click();
  await page.getByLabel('Stake').fill('25');
  await page.getByRole('button', { name: 'Place bet' }).click();
  await expect(page.locator('.notice')).toHaveText('Bet placed');
  await expect(page.locator('.balance')).toContainText('975.00');
  await expect(page.locator('.receipts li')).toHaveCount(1);
  await expect(page.locator('.leg')).toHaveCount(0);
  // Reset after the balance is loaded (the beforeEach reset can race the first balance load).
  await page.getByRole('button', { name: 'reset' }).click();
  await expect(page.locator('.balance')).toContainText('1,000.00');
});

test('places a multiple at the combined odds', async ({ page }) => {
  await addSelections(page, 2);
  await page.getByRole('tab', { name: 'Multiple' }).click();
  await page.getByRole('button', { name: 'Any' }).click();
  await page.getByRole('button', { name: 'Place multiple' }).click();
  await expect(page.locator('.notice')).toHaveText('Bet placed');
  await expect(page.locator('.receipts li').first()).toContainText('2-fold');
  await expect(page.locator('.balance')).toContainText('990.00');
});

test('clicking a selected price removes it from the slip', async ({ page }) => {
  await addSelections(page, 1);
  const selected = page.locator('button.odds[aria-pressed="true"]').first();
  await selected.click();
  await expect(page.locator('.leg')).toHaveCount(0);
});

test('loads the balance once the bet service becomes reachable', async ({ page }) => {
  let failures = 0;
  await page.route('**/me', (route) => (failures++ < 2 ? route.abort() : route.continue()));
  await page.goto('/?sport=1');
  await expect(page.locator('.balance')).toContainText('—');
  await expect(page.locator('.balance')).toContainText('€', { timeout: 10_000 });
  expect(failures).toBeGreaterThanOrEqual(3);
});
