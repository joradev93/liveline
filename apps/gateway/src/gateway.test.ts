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

function collect(ws: WebSocket, count: number): Promise<ServerMessage[]> {
  const out: ServerMessage[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`got ${out.length}/${count} messages`)), 5_000);
    ws.onmessage = (ev) => {
      out.push(serverMessageSchema.parse(JSON.parse(String(ev.data))) as ServerMessage);
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
