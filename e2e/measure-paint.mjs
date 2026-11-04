/**
 * First paint timings in real Chrome, without Lighthouse's simulated throttling (the simulation
 * models server response time and streamed HTML poorly, so it cannot show the effect of a slow
 * gateway). Each run uses a fresh browser context (cold browser cache).
 *
 *   node e2e/measure-paint.mjs --url http://localhost:3000/?sport=1 --runs 10
 *   node e2e/measure-paint.mjs --url ... --mobile --gap 1200
 *
 * --mobile  412×823 phone, DPR 1.75, network 150 ms RTT / 1.6 Mbit/s down, CPU 4× slower
 * --gap     pause between runs in ms (> 1000 makes every run miss the 1 s server snapshot cache)
 *
 * Prints the median and max of: first byte (responseStart), whole HTML received (responseEnd),
 * DOMContentLoaded end (HTML parsed, deferred scripts run: hydration starts), FCP, LCP, and CLS
 * during the first 4 s.
 */
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/?sport=1' },
    runs: { type: 'string', default: '10' },
    mobile: { type: 'boolean', default: false },
    gap: { type: 'string', default: '0' },
  },
});

const browser = await chromium.launch({ channel: 'chrome' });
const samples = [];
for (let i = 0; i < Number(values.runs); i++) {
  await new Promise((r) => setTimeout(r, Number(values.gap)));
  const context = await browser.newContext(
    values.mobile
      ? { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  if (values.mobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    window.__lcp = null;
    window.__cls = 0;
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      window.__lcp = { t: last.startTime, el: last.element?.className || last.element?.tagName };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(values.url, { waitUntil: 'load' });
  await page.waitForTimeout(4_000);
  samples.push(
    await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        ttfb: nav.responseStart,
        htmlDone: nav.responseEnd,
        dcl: nav.domContentLoadedEventEnd,
        fcp: fcp?.startTime ?? null,
        lcp: window.__lcp?.t ?? null,
        lcpElement: window.__lcp?.el ?? null,
        cls: window.__cls,
      };
    }),
  );
  await context.close();
}
await browser.close();

const stat = (k, round = Math.round) => {
  const v = samples.map((s) => s[k]).sort((a, b) => a - b);
  return { median: round(v[Math.floor(v.length / 2)]), max: round(v.at(-1)) };
};
console.log(
  JSON.stringify(
    {
      url: values.url,
      mobile: values.mobile,
      runs: samples.length,
      ttfb: stat('ttfb'),
      htmlDone: stat('htmlDone'),
      dcl: stat('dcl'),
      fcp: stat('fcp'),
      lcp: stat('lcp'),
      cls: stat('cls', (x) => +x.toFixed(3)),
      lcpElements: [...new Set(samples.map((s) => s.lcpElement))],
    },
    null,
    2,
  ),
);
