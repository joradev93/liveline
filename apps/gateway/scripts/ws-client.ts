/**
 * Verification client: subscribes, validates every server message with zod, checks
 * version continuity and prints throughput and tick->client latency.
 *
 *   pnpm --filter @liveline/gateway ws-client -- --topics sport:1,sport:2 --seconds 10
 */
import { hasVersionGap, isStaleDelta, type ServerMessage, type Topic } from '@liveline/protocol';
import { serverMessageSchema } from '@liveline/protocol/schemas';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:7002/ws' },
    topics: { type: 'string', default: 'sport:1' },
    seconds: { type: 'string', default: '10' },
    event: { type: 'boolean', default: false },
  },
});

const topics = values.topics.split(',') as Topic[];
const versions = new Map<string, number>();
const latencies: number[] = [];
const totals = {
  snapshots: 0,
  deltas: 0,
  ops: 0,
  gaps: 0,
  stale: 0,
  invalid: 0,
  errors: 0,
  bytes: 0,
};

const ws = new WebSocket(values.url);
ws.onopen = () => ws.send(JSON.stringify({ t: 'sub', topics }));
ws.onmessage = (ev) => {
  const text = String(ev.data);
  totals.bytes += text.length;
  const parsed = serverMessageSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    totals.invalid++;
    console.error('invalid message', parsed.error.issues[0]);
    return;
  }
  const msg = parsed.data as ServerMessage;
  if (msg.t === 'error') {
    totals.errors++;
    console.error('server error', msg);
    return;
  }
  if (msg.t === 'snapshot') {
    totals.snapshots++;
    versions.set(msg.topic, msg.v);
    const markets = msg.events.reduce((n, e) => n + e.markets.length, 0);
    console.log(
      `snapshot ${msg.topic} v=${msg.v} events=${msg.events.length} markets=${markets} bytes=${text.length}`,
    );
    // Also subscribe to the first event of the first sport topic, to exercise event topics.
    if (
      values.event &&
      msg.topic.startsWith('sport:') &&
      msg.events[0] &&
      !versions.has(`event:${msg.events[0].id}`)
    ) {
      versions.set(`event:${msg.events[0].id}`, -1);
      ws.send(JSON.stringify({ t: 'sub', topics: [`event:${msg.events[0].id}`] }));
    }
    return;
  }
  const current = versions.get(msg.topic) ?? -1;
  if (isStaleDelta(current, msg)) {
    totals.stale++;
    return;
  }
  if (hasVersionGap(current, msg)) {
    totals.gaps++;
    ws.send(JSON.stringify({ t: 'sub', topics: [msg.topic] }));
    return;
  }
  versions.set(msg.topic, msg.v);
  totals.deltas++;
  totals.ops += msg.ops.length;
  latencies.push(Date.now() - msg.ts);
};

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;

setTimeout(
  () => {
    ws.close();
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          ...totals,
          seconds: Number(values.seconds),
          deltasPerSec: +(totals.deltas / Number(values.seconds)).toFixed(1),
          opsPerSec: +(totals.ops / Number(values.seconds)).toFixed(1),
          latencyMs: {
            p50: pct(sorted, 0.5),
            p95: pct(sorted, 0.95),
            p99: pct(sorted, 0.99),
            max: sorted.at(-1),
          },
        },
        null,
        2,
      ),
    );
    process.exit(totals.invalid > 0 ? 1 : 0);
  },
  Number(values.seconds) * 1000,
);
