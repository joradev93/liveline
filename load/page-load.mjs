/**
 * Server render load: GET /?sport=1 at a constant arrival rate (open model: a slow response does
 * not delay the next request). Every page render fetches a sport snapshot from the gateway on the
 * server, so this measures the Next.js server path under many visitors.
 *
 *   node load/page-load.mjs --url http://localhost:3000/?sport=1 --rate 50 --duration 30
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/?sport=1' },
    rate: { type: 'string', default: '50' },
    duration: { type: 'string', default: '30' },
  },
});
const rate = Number(values.rate);
const total = rate * Number(values.duration);

const latencies = [];
let errors = 0;
let bytes = 0;

async function one() {
  const t0 = performance.now();
  try {
    const res = await fetch(values.url, { headers: { 'accept-encoding': 'gzip' } });
    const body = await res.arrayBuffer();
    if (!res.ok) errors++;
    bytes += body.byteLength;
  } catch {
    errors++;
  }
  latencies.push(performance.now() - t0);
}

const started = performance.now();
const pending = [];
for (let i = 0; i < total; i++) {
  const wait = started + (i * 1000) / rate - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  pending.push(one());
}
await Promise.all(pending);
const seconds = (performance.now() - started) / 1000;

latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
const ms = (v) => `${v.toFixed(1)} ms`;
console.log(
  JSON.stringify(
    {
      url: values.url,
      rate,
      requests: latencies.length,
      errors,
      achievedPerSec: +(latencies.length / seconds).toFixed(1),
      p50: ms(pct(0.5)),
      p95: ms(pct(0.95)),
      p99: ms(pct(0.99)),
      max: ms(latencies.at(-1)),
      avgKB: +(bytes / latencies.length / 1024).toFixed(1),
    },
    null,
    2,
  ),
);
