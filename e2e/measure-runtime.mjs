/**
 * Runtime performance under feed load, measured in Chrome:
 *
 * - idle:     10 s watching live updates (FPS, frame times, long tasks, odds cells rendered)
 * - scroll:   10 s of continuous wheel scrolling through the virtualized list
 * - interact: 30 interactions (toggle odds into the betslip, open/close the event panel)
 *             → Event Timing durations per interaction; INP = worst interaction (< 50 interactions)
 *
 *   node e2e/measure-runtime.mjs --rate 500 --cpu 1
 *   node e2e/measure-runtime.mjs --rate 500 --cpu 4     # 4x CPU slowdown (mid-range phone)
 *
 * Needs feed-sim, gateway, bet-api and `next start` running.
 */
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/?sport=1' },
    rate: { type: 'string', default: '500' },
    cpu: { type: 'string', default: '1' },
    headed: { type: 'boolean', default: false },
  },
});
const base = new URL(values.url).origin;

await fetch(`${base}/api/load`, {
  method: 'POST',
  body: JSON.stringify({ rate: Number(values.rate) }),
});

const browser = await chromium.launch({ channel: 'chrome', headless: !values.headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Instrumentation installed before any app code runs.
await page.addInitScript(() => {
  const w = window;
  w.__perf = { frames: [], longTasks: [], events: [] };
  let last = performance.now();
  const loop = (now) => {
    w.__perf.frames.push(now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) =>
    w.__perf.longTasks.push(...l.getEntries().map((e) => e.duration)),
  ).observe({
    type: 'longtask',
    buffered: true,
  });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries())
      if (e.interactionId)
        w.__perf.events.push({ id: e.interactionId, d: e.duration, name: e.name });
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
});

const cdp = await page.context().newCDPSession(page);
await page.goto(values.url);
await page.locator('.conn[data-state="live"]').waitFor();
await page.waitForTimeout(2_000);
if (Number(values.cpu) > 1)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(values.cpu) });

const reset = () =>
  page.evaluate(() => {
    window.__perf.frames = [];
    window.__perf.longTasks = [];
    window.__perf.events = [];
    window.__oddsStart = performance.now();
  });
const collect = () => page.evaluate(() => window.__perf);

function frameStats(frames, seconds) {
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) =>
    +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(1);
  return {
    fps: +(frames.length / seconds).toFixed(1),
    frameP50: pct(0.5),
    frameP95: pct(0.95),
    frameMax: pct(1),
    framesOver33ms: frames.filter((f) => f > 33.4).length,
  };
}

const results = { rate: Number(values.rate), cpuSlowdown: Number(values.cpu) };

// 1) idle under load
await reset();
const rendersBefore = await page.evaluate(() => document.querySelectorAll('button.odds').length);
await page.waitForTimeout(10_000);
let perf = await collect();
// The app's own metrics panel (worker + render counters), read from the DOM.
const panel = await page.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll('.stat')].map((s) => [
      s.querySelector('dt').textContent,
      s.querySelector('dd').textContent,
    ]),
  ),
);
results.idle = {
  ...frameStats(perf.frames, 10),
  longTasks: perf.longTasks.length,
  oddsButtonsInDom: rendersBefore,
  panel,
};

// 2) continuous scrolling
await reset();
await page.mouse.move(400, 400);
const scrollEnd = Date.now() + 10_000;
let direction = 1;
while (Date.now() < scrollEnd) {
  await page.mouse.wheel(0, 120 * direction);
  await page.waitForTimeout(16);
  const y = await page.evaluate(() => scrollY);
  if (y > 12_000) direction = -1;
  if (y < 100) direction = 1;
}
perf = await collect();
results.scroll = { ...frameStats(perf.frames, 10), longTasks: perf.longTasks.length };

// 3) interactions
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(500);
await reset();
for (let i = 0; i < 12; i++) {
  const button = page.locator('.row button.odds:not([disabled])').nth(i * 2);
  await button.click({ timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(150);
  await button.click({ timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(150);
}
for (let i = 0; i < 3; i++) {
  await page.locator('.row-teams').nth(i).click();
  await page
    .locator('.market-block')
    .nth(3)
    .waitFor({ timeout: 3_000 })
    .catch(() => {});
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
// Sport switching: RSC navigation + a new snapshot. Measured separately: it is the heaviest.
const switchDurations = [];
for (const name of ['Tennis', 'Football', 'Basketball', 'Football']) {
  const before = (await collect()).events.length;
  await page.getByRole('link', { name: new RegExp(`^${name}\\b`) }).click();
  await page.locator('.board-head h1', { hasText: name }).waitFor();
  await page.waitForTimeout(400);
  const after = (await collect()).events.slice(before);
  switchDurations.push(Math.max(0, ...after.map((e) => e.d)));
}
results.sportSwitch = { worstInteractionMs: Math.max(...switchDurations), each: switchDurations };
await page.waitForTimeout(500);
perf = await collect();
const byInteraction = new Map();
for (const e of perf.events) byInteraction.set(e.id, Math.max(byInteraction.get(e.id) ?? 0, e.d));
const durations = [...byInteraction.values()].sort((a, b) => a - b);
results.interactions = {
  count: durations.length,
  inp: durations.at(-1) ?? null,
  p50: durations[Math.floor(durations.length / 2)] ?? null,
  longTasks: perf.longTasks.length,
  note: 'Event Timing reports only interactions >= 16 ms; count = interactions above that threshold',
};

if (Number(values.cpu) > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await browser.close();
await fetch(`${base}/api/load`, { method: 'POST', body: JSON.stringify({ rate: 500 }) });
console.log(JSON.stringify(results, null, 2));
