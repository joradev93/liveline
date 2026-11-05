/**
 * Records the demo flow for the README GIF. Frames come from Chrome's screencast (CDP), so no
 * Playwright ffmpeg download is needed.
 *
 *   node e2e/record-demo.mjs [base]            # -> e2e/results/demo/frames/*.jpg + frames.json
 *   node e2e/make-gif.mjs                      # -> docs/demo.gif (pure JS: jpeg-js + gifenc)
 *   node e2e/record-demo.mjs [base] --mobile   # -> e2e/results/demo-mobile/
 *   node e2e/make-gif.mjs 8 96 demo-mobile     # -> docs/demo-mobile.gif
 *
 * Desktop shot list (about 30 s):
 *  1. Football list with live odds flashing (load: 200 ticks/s)
 *  2. Load slider pushed to 2000 ticks/s; metrics panel shows FPS staying at 60
 *  3. Scroll the virtualized list
 *  4. Open a match: all markets from the event topic
 *  5. Add two selections, switch to Multiple, place the bet; receipt + balance update
 *  6. Load back to 200 ticks/s
 *
 * Phone shot list (`--mobile`, 390×844, touch, about 25 s):
 *  1. List with the compact metrics strip in the bottom bar
 *  2. Open the metrics sheet, push the load to 2000 ticks/s, close it
 *  3. Scroll the list while the strip keeps updating
 *  4. Tap a price, open the betslip sheet, place the bet
 *  5. Load back to 200 ticks/s
 *
 * Needs the full stack running (feed-sim, gateway, bet-api, `next start`).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const setRate = (rate) =>
  fetch(`${base}/api/load`, { method: 'POST', body: JSON.stringify({ rate }) });

await setRate(200);
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } },
);
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

const outDir = new URL(mobile ? './results/demo-mobile/' : './results/demo/', import.meta.url)
  .pathname;
rmSync(outDir, { recursive: true, force: true });
mkdirSync(`${outDir}frames`, { recursive: true });
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = `${outDir}frames/${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

await page.goto(`${base}/?sport=1`);
await page.locator('.conn[data-state="live"]').waitFor();
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 85,
  maxWidth: mobile ? 390 : 960,
  maxHeight: mobile ? 844 : 600,
});
await pause(3_000);

if (mobile) {
  await recordPhone();
} else {
  await recordDesktop();
}

await cdp.send('Page.stopScreencast');
await context.close();
await browser.close();
await setRate(200);

// Frame timestamps: screencast frames arrive at irregular times.
writeFileSync(`${outDir}frames.json`, JSON.stringify(frames));
console.log(`${frames.length} frames in ${outDir}frames`);

async function recordPhone() {
  const strip = page.getByRole('button', { name: 'Live metrics and feed load' });
  const slip = page.getByRole('button', { name: /^Betslip/ });
  const slider = page.getByLabel('Feed market updates per second');

  await strip.tap();
  await pause(1_500);
  await slider.fill('2000');
  await pause(2_500);
  await strip.tap();
  await pause(2_000);

  // Touch scrolling cannot be synthesized here; a smooth window scroll looks the same.
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'smooth' }));
  await pause(2_500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(2_000);

  // An upcoming event: it does not end or suspend while the demo runs.
  const row = page.locator('.row[data-status="prematch"]').first();
  for (let i = 0; i < 40 && (await row.count()) === 0; i++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await pause(30);
  }
  await row.scrollIntoViewIfNeeded();
  await pause(800);
  await row.locator('button.odds:not([disabled])').first().tap();
  await pause(1_000);
  await slip.tap();
  await pause(1_200);
  await page.getByRole('button', { name: 'Any' }).tap();
  await pause(600);
  await page.getByRole('button', { name: /^Place bet/ }).tap();
  await pause(2_500);
  await slip.tap();
  await pause(800);

  await strip.tap();
  await pause(800);
  await slider.fill('200');
  await pause(1_500);
  await strip.tap();
  await pause(1_000);
}

async function recordDesktop() {
  // Load slider to 2000 ticks/s (the input is a range; set it like a user drag would).
  const slider = page.getByLabel('Feed market updates per second');
  await slider.focus();
  await slider.fill('2000');
  await pause(4_000);

  await page.mouse.move(500, 500);
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 140);
    await pause(40);
  }
  await pause(800);
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, -140);
    await pause(40);
  }
  await pause(1_000);

  await page.locator('.row[data-status="live"] .row-teams').first().click();
  await pause(3_000);
  await page.keyboard.press('Escape');
  await pause(600);

  // Upcoming events: they do not end or suspend while the demo runs. Live events come first in
  // the list, so scroll down to them.
  const rows = page.locator('.row[data-status="prematch"]');
  for (let i = 0; i < 60 && (await rows.count()) < 4; i++) {
    await page.mouse.wheel(0, 300);
    await pause(30);
  }
  await rows.nth(1).scrollIntoViewIfNeeded();
  await pause(600);
  await rows.nth(1).locator('button.odds:not([disabled])').first().click();
  await pause(600);
  await rows.nth(3).locator('button.odds:not([disabled])').nth(1).click();
  await pause(800);
  await page.getByRole('tab', { name: 'Multiple' }).click();
  await page.getByRole('button', { name: 'Any' }).click();
  await pause(800);
  await page.getByRole('button', { name: 'Place multiple' }).click();
  await pause(3_000);

  await slider.fill('200');
  await pause(1_500);
}
