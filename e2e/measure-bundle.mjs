/**
 * Measures the JavaScript a first visit downloads, as the browser sees it
 * (Resource Timing `encodedBodySize` = bytes on the wire after gzip/brotli).
 *
 *   pnpm --filter @liveline/web build && pnpm --filter @liveline/web start   # in another shell
 *   node e2e/measure-bundle.mjs [url]
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:3000/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(500);

const resources = await page.evaluate(() =>
  performance.getEntriesByType('resource').map((r) => ({
    name: r.name,
    type: r.initiatorType,
    encoded: r.encodedBodySize,
    decoded: r.decodedBodySize,
  })),
);
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  return { encoded: n.encodedBodySize, decoded: n.decodedBodySize };
});
await browser.close();

const isScript = (r) => r.type === 'script' || /\.m?js(\?|$)/.test(r.name);
const scripts = resources.filter((r) => isScript(r) && !r.name.includes('worker'));
const workers = resources.filter(
  (r) => r.name.includes('worker') || (r.type === 'other' && /\.js/.test(r.name)),
);
const kb = (n) => (n / 1024).toFixed(1);
const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);

for (const r of scripts)
  console.log(`  ${kb(r.encoded).padStart(6)} KB  ${new URL(r.name).pathname}`);
console.log(
  `initial JS (main thread): ${kb(sum(scripts, 'encoded'))} KB compressed, ${kb(sum(scripts, 'decoded'))} KB uncompressed, ${scripts.length} files`,
);
console.log(`worker JS: ${kb(sum(workers, 'encoded'))} KB compressed`);
console.log(`HTML document: ${kb(nav.encoded)} KB compressed, ${kb(nav.decoded)} KB uncompressed`);
