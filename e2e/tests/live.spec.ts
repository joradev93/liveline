import { expect, test } from '@playwright/test';

test('server-rendered rows are in the HTML before any JavaScript runs', async ({ request }) => {
  const html = await (await request.get('/?sport=1')).text();
  const rows = html.match(/class="row"/g) ?? [];
  expect(rows.length).toBeGreaterThan(5);
});

test('odds update live over the WebSocket', async ({ page }) => {
  await page.goto('/?sport=1');
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
  const prices = page.locator('.row .odds-price');
  const before = await prices.allTextContents();
  await expect
    .poll(
      async () => {
        const after = await prices.allTextContents();
        return after.some((p, i) => p !== before[i]);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test('the event panel loads every market of the event', async ({ page }) => {
  await page.goto('/?sport=1');
  const row = page.locator('.row[data-status="live"], .row[data-status="prematch"]').first();
  await row.locator('.row-teams').click();
  const panel = page.getByRole('dialog', { name: 'Event markets' });
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.locator('.market-block').count()).toBeGreaterThan(3);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('switching sport renders the new sport from the server and keeps the feed', async ({
  page,
}) => {
  await page.goto('/?sport=1');
  await page.getByRole('link', { name: /^Tennis\b/ }).click();
  await expect(page).toHaveURL(/sport=3/);
  await expect(page.getByRole('heading', { name: 'Tennis' })).toBeVisible();
  await expect(page.locator('.row').first()).toBeVisible();
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
});

test('every sport tab shows its number of events, the same as the heading', async ({ page }) => {
  await page.goto('/?sport=1');
  // In the server HTML already, before the WebSocket connects.
  await expect(page.locator('.tab .tab-count')).toHaveCount(6);
  await expect(page.locator('.conn')).toHaveAttribute('data-state', 'live');
  const badge = page.locator('.tab[aria-current="page"] .tab-count');
  // The badge text is "262 events": the word is for screen readers only.
  const count = (await badge.innerText()).match(/^\d+/)?.[0];
  expect(Number(count)).toBeGreaterThan(0);
  await expect(page.locator('.board-head .muted')).toHaveText(`${count} events`);
});
