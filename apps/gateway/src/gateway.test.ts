import { FeedServer, FeedSimulator } from '@liveline/feed-sim';
import type { ServerMessage } from '@liveline/protocol';
import { serverMessageSchema } from '@liveline/protocol/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGateway } from './gateway.js';

let feed: FeedServer;
let gateway: Awaited<ReturnType<typeof startGateway>>;

beforeAll(async () => {
  feed = new FeedServer(new FeedSimulator({ seed: 3, eventCount: 60 }, Date.now()), {
    port: 0,
    rate: 800,
  });
  await feed.start();
  gateway = await startGateway({
    port: 0,
    feedUrl: `ws://127.0.0.1:${feed.port}/feed`,
    flushMs: 50,
    highWaterMark: 512 * 1024,
    maxBackpressure: 8 * 1024 * 1024,
    maxTopicsPerClient: 50,
    compression: false,
  });
  for (let i = 0; i < 50 && !gateway.feed.connected; i++)
    await new Promise((r) => setTimeout(r, 20));
});

afterAll(async () => {
  gateway.stop();
  await feed.stop();
});

/** Collects `count` messages; `counts` messages are skipped unless `withCounts` is set. */
function collect(ws: WebSocket, count: number, withCounts = false): Promise<ServerMessage[]> {
  const out: ServerMessage[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`got ${out.length}/${count} messages`)), 5_000);
    ws.onmessage = (ev) => {
      const msg = serverMessageSchema.parse(JSON.parse(String(ev.data))) as ServerMessage;
      if (msg.t === 'counts' && !withCounts) return;
      out.push(msg);
      if (out.length === count) {
        clearTimeout(timer);
        resolve(out);
      }
    };
  });
}

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('connect failed'));
  });

describe('gateway over real sockets', () => {
  it('sends a snapshot and then continuous deltas', async () => {
    const ws = await open(`ws://127.0.0.1:${gateway.server.port}/ws`);
    const messages = collect(ws, 6);
    ws.send(JSON.stringify({ t: 'sub', topics: ['sport:1'] }));
    const [snapshot, ...deltas] = await messages;
    ws.close();

    expect(snapshot?.t).toBe('snapshot');
    let version = snapshot?.t === 'snapshot' ? snapshot.v : -1;
    for (const delta of deltas) {
      expect(delta.t).toBe('delta');
      if (delta.t !== 'delta') continue;
      expect(delta.from).toBeLessThanOrEqual(version);
      expect(delta.v).toBeGreaterThan(version);
      version = delta.v;
    }
  });

  it('answers bad messages and unknown topics with errors', async () => {
    const ws = await open(`ws://127.0.0.1:${gateway.server.port}/ws`);
    const messages = collect(ws, 2);
    ws.send('not json');
    ws.send(JSON.stringify({ t: 'sub', topics: ['event:999999'] }));
    const [bad, unknown] = await messages;
    ws.close();
    expect(bad).toMatchObject({ t: 'error', code: 'BAD_MESSAGE' });
    expect(unknown).toMatchObject({ t: 'error', code: 'UNKNOWN_TOPIC' });
  });

  it('sends the event counts per sport on connect and over HTTP', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${gateway.server.port}/ws`);
    const [first] = await collect(ws, 1, true);
    ws.close();
    expect(first?.t).toBe('counts');
    if (first?.t !== 'counts') return;
    const total = Object.values(first.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(gateway.state.eventCount);

    const res = await fetch(`http://127.0.0.1:${gateway.server.port}/counts`);
    expect(res.status).toBe(200);
    expect(serverMessageSchema.parse(await res.json())).toMatchObject({ t: 'counts' });
  });

  it('serves snapshots and stats over HTTP', async () => {
    const base = `http://127.0.0.1:${gateway.server.port}`;
    const snap = (await (await fetch(`${base}/snapshot/sport:1`)).json()) as {
      t: string;
      events: unknown[];
    };
    expect(snap.t).toBe('snapshot');
    expect(snap.events.length).toBeGreaterThan(0);
    expect((await fetch(`${base}/snapshot/sport:99`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
