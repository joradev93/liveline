/**
 * Measures the JavaScript a first visit downloads, as the browser sees it
 * (Resource Timing `encodedBodySize` = bytes on the wire after gzip/brotli).
 *
 * "initial" = scripts referenced by the raw server HTML. "lazy" = chunks loaded after hydration
 * (dynamic imports). The feed worker is counted separately.
 *
 *   pnpm --filter @liveline/web build && pnpm --filter @liveline/web start   # in another shell
 *   node e2e/measure-bundle.mjs [url]
 */
import { chromium } from '@playwright/test';
import { brotliCompressSync, constants } from 'node:zlib';

const url = process.argv[2] ?? 'http://localhost:3000/';

// "initial" = scripts the server HTML references (script src or preload), parsed from the raw HTML.
const rawHtml = await (await fetch(url)).text();
const htmlScripts = [
  ...rawHtml.matchAll(/<script[^>]+src="([^"]+)"/g),
  ...rawHtml.matchAll(
    /<link[^>]+rel="preload"[^>]+as="script"[^>]+href="([^"]+)"|<link[^>]+href="([^"]+)"[^>]+as="script"/g,
  ),
]
  .map((m) => m[1] ?? m[2])
  .filter(Boolean)
  .map((src) => new URL(src.replaceAll('&amp;', '&'), url).pathname);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1_000);

const { resources, nav } = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  return {
    resources: performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      type: r.initiatorType,
      encoded: r.encodedBodySize,
      decoded: r.decodedBodySize,
    })),
    nav: { encoded: n.encodedBodySize, decoded: n.decodedBodySize },
  };
});
await browser.close();

const path = (r) => new URL(r.name).pathname;
const isJs = (r) => /\.m?js(\?|$)/.test(r.name);
const isWorker = (r) => r.name.includes('worker') || (isJs(r) && r.type === 'other');
const scripts = resources.filter((r) => isJs(r) && !isWorker(r));
const initial = scripts.filter((r) => htmlScripts.includes(path(r)));
const lazy = scripts.filter((r) => !htmlScripts.includes(path(r)));
const workers = resources.filter((r) => isJs(r) && isWorker(r));

const kb = (n) => (n / 1024).toFixed(1);
const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);

for (const r of initial) console.log(`  ${kb(r.encoded).padStart(6)} KB  ${path(r)}`);
console.log(
  `initial JS (in the HTML): ${kb(sum(initial, 'encoded'))} KB compressed, ${kb(sum(initial, 'decoded'))} KB uncompressed, ${initial.length} files`,
);
// Brotli size of the same files, computed here (q11). `next start` only serves gzip; Vercel serves brotli.
let brotli = 0;
for (const r of initial) {
  const body = Buffer.from(
    await (await fetch(r.name, { headers: { 'accept-encoding': 'identity' } })).arrayBuffer(),
  );
  brotli += brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}
console.log(`initial JS, same files with brotli q11 (computed locally): ${kb(brotli)} KB`);
console.log(
  `lazy JS (after hydration): ${kb(sum(lazy, 'encoded'))} KB compressed, ${lazy.length} files`,
);
console.log(`worker JS: ${kb(sum(workers, 'encoded'))} KB compressed, ${workers.length} files`);
console.log(`HTML document: ${kb(nav.encoded)} KB compressed, ${kb(nav.decoded)} KB uncompressed`);
