import { expect, test } from '@playwright/test';

// Phone: touch input. Touch browsers keep `:hover` on the last tapped element.
test.use({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });

test('a tapped price turns into the selected colour at once', async ({ page }) => {
  await page.goto('/?sport=1');
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
  // A handle, not a locator: live rows reorder, and a locator could resolve to another button.
  const button = await page.locator('.row button.odds:not([disabled])').first().elementHandle();
  if (!button) throw new Error('no enabled odds button');
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  );
  expect(brand).toBe('#f5b301');

  await button.tap();
  await expect(page.locator('.leg')).toHaveCount(1);
  // The only thing between the tap and the colour is the 120 ms background transition.
  await expect
    .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 1_000 })
    .toBe('rgb(245, 179, 1)');

  await button.tap();
  await expect(page.locator('.leg')).toHaveCount(0);
});

test('the bottom bar keeps metrics visible and opens metrics and betslip as separate sheets', async ({
  page,
}) => {
  await page.goto('/?sport=1');
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
  const metrics = page.getByRole('region', { name: 'Live metrics' });
  const slip = page.getByRole('region', { name: 'Betslip' });

  // Closed: only the compact strip, with live numbers.
  await expect(page.locator('.strip')).toBeVisible();
  await expect(page.locator('.mini-value').nth(1)).not.toHaveText('—');
  await expect(metrics).toBeHidden();
  await expect(slip).toBeHidden();

  await page.getByRole('button', { name: 'Live metrics and feed load' }).tap();
  await expect(metrics).toBeVisible();
  await expect(page.getByLabel('Feed market updates per second')).toBeVisible();
  await expect(slip).toBeHidden();

  await page.getByRole('button', { name: /Betslip/ }).tap();
  await expect(slip).toBeVisible();
  await expect(metrics).toBeHidden();
  await expect(page.locator('.strip')).toBeVisible();
});

test('the page is not wider than the phone screen', async ({ page }) => {
  await page.goto('/?sport=1');
  await expect(page.locator('.tab .tab-count')).toHaveCount(6);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(412);
});
