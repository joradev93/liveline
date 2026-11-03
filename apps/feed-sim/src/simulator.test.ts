import { MAX_ODDS, MIN_ODDS, type FeedChange } from '@liveline/protocol';
import { describe, expect, it } from 'vitest';
import { FeedSimulator } from './simulator.js';

const T0 = 1_700_000_000_000;

function run(sim: FeedSimulator, ticks: number, start = T0): FeedChange[] {
  const out: FeedChange[] = [];
  for (let i = 0; i < ticks; i++) {
    const change = sim.tick(start + i);
    if (change) out.push(change);
  }
  return out;
}

describe('FeedSimulator', () => {
  it('is deterministic for a seed', () => {
    const a = new FeedSimulator({ seed: 7, eventCount: 50 }, T0);
    const b = new FeedSimulator({ seed: 7, eventCount: 50 }, T0);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(run(a, 500)).toEqual(run(b, 500));
  });

  it('differs for another seed', () => {
    const a = new FeedSimulator({ seed: 1, eventCount: 20 }, T0);
    const b = new FeedSimulator({ seed: 2, eventCount: 20 }, T0);
    expect(JSON.stringify(a.snapshot())).not.toBe(JSON.stringify(b.snapshot()));
  });

  it('creates 5-20 markets per event with 3 main markets', () => {
    const sim = new FeedSimulator({ seed: 3, eventCount: 200 }, T0);
    for (const event of sim.snapshot()) {
      expect(event.markets.length).toBeGreaterThanOrEqual(5);
      expect(event.markets.length).toBeLessThanOrEqual(20);
      expect(event.markets.filter((m) => m.main)).toHaveLength(3);
      for (const market of event.markets) expect(market.eventId).toBe(event.id);
    }
  });

  it('keeps every price inside the odds range with 2 decimals', () => {
    const sim = new FeedSimulator({ seed: 11, eventCount: 100 }, T0);
    const changes = run(sim, 5_000);
    expect(changes.length).toBeGreaterThan(4_000);
    for (const change of changes) {
      if (change.k !== 'price') continue;
      expect(Object.keys(change.sel).length).toBeGreaterThan(0);
      for (const price of Object.values(change.sel)) {
        expect(price).toBeGreaterThanOrEqual(MIN_ODDS);
        expect(price).toBeLessThanOrEqual(MAX_ODDS);
        expect(Number(price.toFixed(2))).toBe(price);
      }
    }
  });

  it('only moves open markets of prematch or live events', () => {
    const sim = new FeedSimulator({ seed: 5, eventCount: 100 }, T0);
    const suspended = new Set<number>();
    for (const change of run(sim, 3_000)) {
      if (change.k === 'mst' && change.st === 'suspended') suspended.add(change.m);
      if (change.k === 'price') expect(suspended.has(change.m)).toBe(false);
    }
    expect(suspended.size).toBeGreaterThan(0);
  });

  it('runs the lifecycle prematch -> live -> settled -> removed and keeps the event count', () => {
    const sim = new FeedSimulator(
      { seed: 9, eventCount: 30, liveShare: 0, liveDurationMs: 60_000 },
      T0,
    );
    const seen = { live: 0, settled: 0, rm: 0, add: 0 };
    // 25 sim minutes in 100 ms steps: every prematch event (starts within 20 min) goes live and ends.
    for (let t = T0; t < T0 + 25 * 60_000; t += 100) {
      for (const change of sim.advance(t)) {
        if (change.k === 'est' && change.st === 'live' && change.sc?.join() === '0,0') seen.live++;
        if (change.k === 'est' && change.st === 'settled') seen.settled++;
        if (change.k === 'rm') seen.rm++;
        if (change.k === 'add') seen.add++;
      }
    }
    expect(seen.live).toBeGreaterThanOrEqual(30);
    expect(seen.settled).toBeGreaterThanOrEqual(30);
    expect(seen.rm).toBe(seen.add);
    expect(sim.eventCount).toBe(30);
  });

  it('reopens suspended markets', () => {
    const sim = new FeedSimulator({ seed: 4, eventCount: 50, liveShare: 1 }, T0);
    const suspended = run(sim, 2_000).filter((c) => c.k === 'mst' && c.st === 'suspended');
    expect(suspended.length).toBeGreaterThan(0);
    const reopened = sim.advance(T0 + 10_000).filter((c) => c.k === 'mst' && c.st === 'open');
    expect(reopened.length).toBe(suspended.length);
  });
});
