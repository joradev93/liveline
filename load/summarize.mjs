// Prints one line per load step from load/results/ (k6 summary + gateway CPU samples).
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./results/', import.meta.url);
const steps = readdirSync(dir)
  .map((f) => /^k6-(\d+)\.json$/.exec(f)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);

console.log(
  '| clients | tick→client p50 | p95 | p99 | max | msgs/s received | version gaps | failed upgrades | gateway CPU avg / max | gateway RSS max |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const vus of steps) {
  const k6 = JSON.parse(readFileSync(new URL(`k6-${vus}.json`, dir)));
  const m = k6.metrics;
  const lat = m.tick_latency;
  const cpu = readFileSync(new URL(`gw-cpu-${vus}.txt`, dir), 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((r) => r.length === 2);
  // Skip the first two samples (start-up) when averaging CPU.
  const load = cpu.slice(2);
  const avg = load.reduce((s, r) => s + r[0], 0) / Math.max(1, load.length);
  const max = Math.max(...load.map((r) => r[0]));
  const rss = Math.max(...cpu.map((r) => r[1])) / 1024;
  const checks = m.checks ?? { fails: 0 };
  console.log(
    `| ${vus} | ${lat.med} ms | ${lat['p(95)']} ms | ${lat['p(99)']} ms | ${lat.max} ms | ${Math.round(m.ws_msgs_received.rate)} | ${m.version_gaps?.count ?? 0} | ${checks.fails} | ${avg.toFixed(0)}% / ${max.toFixed(0)}% | ${rss.toFixed(0)} MB |`,
  );
}
