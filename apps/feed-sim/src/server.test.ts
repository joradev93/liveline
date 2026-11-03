import type { FeedMessage } from '@liveline/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { clampRate, FeedServer } from './server.js';
import { FeedSimulator } from './simulator.js';

let server: FeedServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('clampRate', () => {
  it('keeps the rate inside 50-2000', () => {
    expect(clampRate(1)).toBe(50);
    expect(clampRate(500.4)).toBe(500);
    expect(clampRate(99_999)).toBe(2000);
  });
});

describe('FeedServer', () => {
  it('sends a snapshot, then batches with consecutive seq numbers', async () => {
    server = new FeedServer(new FeedSimulator({ seed: 1, eventCount: 20 }, Date.now()), {
      port: 0,
      rate: 500,
    });
    await server.start();

    const messages: FeedMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/feed`);
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (ev) => {
        messages.push(JSON.parse(String(ev.data)) as FeedMessage);
        if (messages.length >= 6) resolve();
      };
      ws.onerror = () => reject(new Error('ws error'));
    });
    ws.close();

    const [first, ...rest] = messages;
    expect(first?.t).toBe('feed:snapshot');
    if (first?.t === 'feed:snapshot') expect(first.events).toHaveLength(20);
    let expected = (first?.seq ?? 0) + 1;
    for (const msg of rest) {
      expect(msg.t).toBe('feed:batch');
      expect(msg.seq).toBe(expected++);
    }
  });

  it('changes the rate over HTTP', async () => {
    server = new FeedServer(new FeedSimulator({ seed: 1, eventCount: 5 }, Date.now()), {
      port: 0,
      rate: 100,
    });
    await server.start();
    const res = await fetch(`http://127.0.0.1:${server.port}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rate: 750 }),
    });
    expect(await res.json()).toEqual({ rate: 750 });
    expect(server.tickRate).toBe(750);
  });

  it('protects the rate and the bus with tokens when configured', async () => {
    server = new FeedServer(new FeedSimulator({ seed: 1, eventCount: 5 }, Date.now()), {
      port: 0,
      rate: 100,
      controlToken: 'ctl-secret',
      busToken: 'bus-secret',
    });
    await server.start();
    const base = `127.0.0.1:${server.port}`;
    const post = (auth?: string) =>
      fetch(`http://${base}/rate`, {
        method: 'POST',
        headers: auth ? { authorization: auth } : {},
        body: JSON.stringify({ rate: 300 }),
      });
    expect((await post()).status).toBe(401);
    expect((await post('Bearer wrong')).status).toBe(401);
    expect((await post('Bearer ctl-secret')).status).toBe(200);

    const opens = (url: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url);
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
      });
    expect(await opens(`ws://${base}/feed`)).toBe(false);
    expect(await opens(`ws://${base}/feed?token=bus-secret`)).toBe(true);
  });
});
