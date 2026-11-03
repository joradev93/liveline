/**
 * Lightweight load generator (Node, runs on the host, several processes).
 * k6 in Docker saturates its VM around 10k connections, so this finds where the
 * *gateway* breaks instead of where the load generator breaks.
 *
 * Each socket subscribes to one sport topic and records tick->client latency of every
 * delta (regex on the header, no full JSON.parse). Latencies are only recorded during the
 * hold phase, after all sockets are connected.
 *
 *   node load/swarm.mjs --clients 10000 --procs 6 --ramp 60 --hold 60
 */
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:7002/ws' },
    clients: { type: 'string', default: '1000' },
    procs: { type: 'string', default: '4' },
    ramp: { type: 'string', default: '30' },
    hold: { type: 'string', default: '60' },
    worker: { type: 'string' },
  },
});

const HEAD = /^\{"t":"(\w+)","topic":"[\w:]+",(?:"from":(\d+),)?"v":(\d+)/;
const TS = /"ts":(\d+)\}$/;
const BUCKETS = 60_000; // 1 ms buckets up to 60 s

if (values.worker !== undefined) {
  const id = Number(values.worker);
  const count = Number(values.clients);
  const rampMs = Number(values.ramp) * 1000;
  const hist = new Uint32Array(BUCKETS + 1);
  const totals = { open: 0, failed: 0, closed: 0, deltas: 0, gaps: 0, snapshots: 0 };
  let measuring = false;

  const connect = (i) => {
    const topic = `sport:${1 + ((id * count + i) % 6)}`;
    // Several URLs (comma separated) spread sockets over destination IPs: one IP pair only
    // has ~16k ephemeral ports on macOS.
    const urls = values.url.split(',');
    const ws = new WebSocket(urls[(id * count + i) % urls.length]);
    let version = -1;
    ws.onopen = () => {
      totals.open++;
      ws.send(JSON.stringify({ t: 'sub', topics: [topic] }));
    };
    ws.onerror = () => totals.failed++;
    ws.onclose = () => totals.closed++;
    ws.onmessage = (ev) => {
      const msg = ev.data;
      const head = HEAD.exec(msg.slice(0, 120));
      if (!head) return;
      const v = Number(head[3]);
      if (head[1] === 'snapshot') {
        totals.snapshots++;
        version = v;
        return;
      }
      if (v <= version) return;
      if (Number(head[2]) > version) {
        totals.gaps++;
        ws.send(JSON.stringify({ t: 'sub', topics: [topic] }));
        return;
      }
      version = v;
      totals.deltas++;
      if (!measuring) return;
      const ts = TS.exec(msg.slice(-40));
      if (ts) hist[Math.min(BUCKETS, Math.max(0, Date.now() - Number(ts[1])))]++;
    };
  };
  for (let i = 0; i < count; i++) setTimeout(() => connect(i), (rampMs * i) / count);

  process.on('message', (cmd) => {
    if (cmd === 'measure') {
      measuring = true;
      totals.deltas = 0;
    }
    if (cmd === 'report') process.send({ hist: [...hist], totals }, () => process.exit(0));
  });
} else {
  const clients = Number(values.clients);
  const procs = Number(values.procs);
  const workers = Array.from({ length: procs }, (_, i) =>
    fork(new URL(import.meta.url).pathname, [
      '--worker',
      String(i),
      '--clients',
      String(Math.ceil(clients / procs)),
      '--ramp',
      values.ramp,
      '--url',
      values.url,
    ]),
  );
  const http = values.url.split(',')[0].replace('ws://', 'http://').replace(/\/ws$/, '');
  const stats = async () => (await fetch(`${http}/stats`)).json();

  await new Promise((r) => setTimeout(r, Number(values.ramp) * 1000 + 5000));
  const before = await stats();
  console.log(`connected clients at gateway: ${before.clients}; measuring for ${values.hold}s`);
  for (const w of workers) w.send('measure');
  await new Promise((r) => setTimeout(r, Number(values.hold) * 1000));
  const after = await stats();

  const reports = await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve) => {
          w.once('message', resolve);
          w.send('report');
        }),
    ),
  );
  const hist = new Array(BUCKETS + 1).fill(0);
  const totals = { open: 0, failed: 0, closed: 0, deltas: 0, gaps: 0, snapshots: 0 };
  for (const r of reports) {
    r.hist.forEach((n, i) => (hist[i] += n));
    for (const k of Object.keys(totals)) totals[k] += r.totals[k];
  }
  const n = hist.reduce((a, b) => a + b, 0);
  const pct = (p) => {
    let acc = 0;
    for (let i = 0; i < hist.length; i++) if ((acc += hist[i]) >= n * p) return i;
    return NaN;
  };
  let max = 0;
  hist.forEach((c, i) => c && (max = i));
  console.log(
    JSON.stringify(
      {
        clients,
        gatewayClients: after.clients,
        ...totals,
        deltasPerSec: Math.round(totals.deltas / Number(values.hold)),
        latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max },
        gateway: {
          deltasSkipped: after.hub.deltasSkipped - before.hub.deltasSkipped,
          maxFlushMs: +after.hub.maxFlushMs.toFixed(1),
          rssMb: after.memoryMb,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
