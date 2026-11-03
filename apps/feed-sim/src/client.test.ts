import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedClient } from './client.js';
import { FeedServer } from './server.js';
import { FeedSimulator } from './simulator.js';

let server: FeedServer | undefined;
let client: FeedClient | undefined;
afterEach(async () => {
  client?.stop();
  await server?.stop();
  server = client = undefined;
});

/** A port nobody listens on (yet). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const waitFor = async (check: () => boolean, ms = 5_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('FeedClient', () => {
  it('keeps retrying while the feed is down and connects once it is up', async () => {
    const port = await freePort();
    let snapshots = 0;
    client = new FeedClient(`ws://127.0.0.1:${port}/feed`, {
      onSnapshot: () => snapshots++,
      onChanges: () => {},
    });
    client.start();
    await waitFor(() => client!.counters.reconnects >= 2);
    expect(client.connected).toBe(false);

    server = new FeedServer(new FeedSimulator({ seed: 1, eventCount: 5 }, Date.now()), {
      port,
      rate: 100,
    });
    await server.start();
    await waitFor(() => client!.connected);
    expect(snapshots).toBe(1);
  });

  it('applies batches in order after the snapshot', async () => {
    server = new FeedServer(new FeedSimulator({ seed: 2, eventCount: 10 }, Date.now()), {
      port: 0,
      rate: 1000,
    });
    await server.start();
    let changes = 0;
    client = new FeedClient(`ws://127.0.0.1:${server.port}/feed`, {
      onSnapshot: () => {},
      onChanges: (c) => (changes += c.length),
    });
    client.start();
    await waitFor(() => changes > 50);
    expect(client.counters.gaps).toBe(0);
  });
});
