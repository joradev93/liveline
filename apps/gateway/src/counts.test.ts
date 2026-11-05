import { describe, expect, it } from 'vitest';
import { CountsTracker } from './counts.js';
import { MarketState } from './state.js';
import { event } from './test-utils.js';

const noop = () => {};

describe('CountsTracker', () => {
  it('stays silent until the feed delivered events', () => {
    const tracker = new CountsTracker(new MarketState());
    expect(tracker.poll()).toBeNull();
    expect(tracker.payload).toBeNull();
  });

  it('reports every known sport, then only changes', () => {
    const state = new MarketState();
    state.reset([event(1, 1, [11]), event(2, 1, [21]), event(3, 2, [31])]);
    const tracker = new CountsTracker(state);

    const first = JSON.parse(tracker.poll() ?? 'null');
    expect(first).toEqual({ t: 'counts', counts: { 1: 2, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 } });
    expect(tracker.poll()).toBeNull();

    state.apply({ k: 'rm', e: 1, ts: 0 }, noop);
    state.apply({ k: 'add', event: event(4, 3, [41]), ts: 0 }, noop);
    expect(JSON.parse(tracker.poll() ?? 'null').counts).toMatchObject({ 1: 1, 2: 1, 3: 1 });
    expect(tracker.payload).toContain('"1":1');
  });
});
