// Prints the key numbers of every Lighthouse report in a Lighthouse CI output folder.
//   node e2e/lh-summary.mjs e2e/.lighthouseci
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.lighthouseci';
const reports = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f));
const rows = reports.map((f) => {
  const lhr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const a = lhr.audits;
  return {
    preset: lhr.configSettings.formFactor,
    perf: Math.round(lhr.categories.performance.score * 100),
    a11y: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
    bp: Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
    fcp: Math.round(a['first-contentful-paint'].numericValue),
    lcp: Math.round(a['largest-contentful-paint'].numericValue),
    tbt: Math.round(a['total-blocking-time'].numericValue),
    cls: +a['cumulative-layout-shift'].numericValue.toFixed(3),
    si: Math.round(a['speed-index'].numericValue),
  };
});
console.table(rows);
const median = (k) => rows.map((r) => r[k]).sort((x, y) => x - y)[Math.floor(rows.length / 2)];
console.log(
  'median',
  Object.fromEntries(
    ['perf', 'a11y', 'bp', 'fcp', 'lcp', 'tbt', 'cls', 'si'].map((k) => [k, median(k)]),
  ),
);
