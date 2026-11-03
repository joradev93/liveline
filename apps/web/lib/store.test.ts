import type { SportEvent } from '@liveline/protocol';
import { describe, expect, it, vi } from 'vitest';
import { eventKey, LiveStore, marketKey, topicKey } from './store';

function event(
  id: number,
  status: SportEvent['status'],
  start: number,
  marketIds: number[],
  mainCount = 3,
): SportEvent {
  return {
    id,
    sportId: 1,
    league: 'L',
    home: `H${id}`,
    away: `A${id}`,
    start,
    status,
    markets: marketIds.map((m, i) => ({
      id: m,
      eventId: id,
      type: 'match-result',
      name: `M${m}`,
      status: 'open',
      main: i < mainCount,
      sel: [
        { k: '1', name: 'Home', p: 2 },
        { k: '2', name: 'Away', p: 3 },
      ],
    })),
  };
}

function setup() {
  const store = new LiveStore();
  store.loadSnapshot('sport:1', [
    event(1, 'prematch', 300, [11, 12, 13]),
    event(2, 'live', 200, [21, 22, 23]),
    event(3, 'prematch', 100, [31, 32, 33]),
  ]);
  return store;
}

describe('LiveStore', () => {
  it('orders topic events: live first, then upcoming by start time', () => {
    expect(setup().getTopicEventIds('sport:1')).toEqual([2, 3, 1]);
  });

  it('returns the same array until the list changes', () => {
    const store = setup();
    const ids = store.getTopicEventIds('sport:1');
    store.applyItems([{ kind: 'delta', topic: 'sport:1', ops: [{ m: 11, sel: { '1': 2.5 } }] }]);
    expect(store.getTopicEventIds('sport:1')).toBe(ids);
  });

  it('notifies only the changed market and keeps other market objects', () => {
    const store = setup();
    const changed = vi.fn();
    const untouched = vi.fn();
    store.subscribe(marketKey(11), changed);
    store.subscribe(marketKey(12), untouched);
    const before12 = store.getMarket(12);

    store.applyItems([
      {
        kind: 'delta',
        topic: 'sport:1',
        ops: [
          { m: 11, sel: { '1': 2.5 } },
          { m: 11, sel: { '2': 2.9 } },
        ],
      },
    ]);
    expect(changed).toHaveBeenCalledTimes(1); // once per batch, not per op
    expect(untouched).not.toHaveBeenCalled();
    expect(store.getPrice(11, '1')).toBe(2.5);
    expect(store.getPrice(11, '2')).toBe(2.9);
    expect(store.getMarket(12)).toBe(before12);
  });

  it('does not notify when a delta repeats the current value', () => {
    const store = setup();
    const listener = vi.fn();
    store.subscribe(marketKey(11), listener);
    store.applyItems([{ kind: 'delta', topic: 'sport:1', ops: [{ m: 11, sel: { '1': 2 } }] }]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the market shape object across price ticks', () => {
    const store = setup();
    const shape = store.getMarketShape(11);
    store.applyItems([
      { kind: 'delta', topic: 'sport:1', ops: [{ m: 11, sel: { '1': 7 }, st: 'suspended' }] },
    ]);
    expect(store.getMarketShape(11)).toBe(shape);
    expect(store.getMarket(11)?.status).toBe('suspended');
  });

  it('re-sorts when an event goes live and notifies the event and the list', () => {
    const store = setup();
    const onEvent = vi.fn();
    const onList = vi.fn();
    store.subscribe(eventKey(1), onEvent);
    store.subscribe(topicKey('sport:1'), onList);
    store.applyItems([
      { kind: 'delta', topic: 'sport:1', ops: [{ e: 1, est: 'live', sc: [0, 0] }] },
    ]);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onList).toHaveBeenCalledTimes(1);
    expect(store.getTopicEventIds('sport:1')).toEqual([2, 1, 3]);
    expect(store.getEvent(1)?.score).toEqual([0, 0]);
  });

  it('adds and removes events', () => {
    const store = setup();
    store.applyItems([
      {
        kind: 'delta',
        topic: 'sport:1',
        ops: [{ add: event(4, 'prematch', 50, [41, 42, 43]) }, { rm: 2 }],
      },
    ]);
    expect(store.getTopicEventIds('sport:1')).toEqual([4, 3, 1]);
    expect(store.getEvent(2)).toBeUndefined();
    expect(store.getMarket(21)).toBeUndefined();
    expect(store.getPrice(41, '1')).toBe(2);
  });

  it('keeps an event while another topic references it', () => {
    const store = setup();
    store.loadSnapshot('event:2', [event(2, 'live', 200, [21, 22, 23, 24, 25])]);
    expect(store.getEvent(2)?.all).toEqual([21, 22, 23, 24, 25]);
    expect(store.getEvent(2)?.main).toEqual([21, 22, 23]);

    // A new sport snapshot (main markets only) must not forget the full market list.
    store.loadSnapshot('sport:1', [event(2, 'live', 200, [21, 22, 23])]);
    expect(store.getEvent(2)?.all).toHaveLength(5);

    store.dropTopic('sport:1');
    expect(store.getEvent(2)).toBeDefined();
    expect(store.getEvent(1)).toBeUndefined();
    store.dropTopic('event:2');
    expect(store.getEvent(2)).toBeUndefined();
    expect(store.getMarket(25)).toBeUndefined();
  });

  it('silent snapshot loads do not call listeners', () => {
    const store = new LiveStore();
    const listener = vi.fn();
    store.subscribe(topicKey('sport:1'), listener);
    store.loadSnapshot('sport:1', [event(1, 'live', 0, [11, 12, 13])], { silent: true });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getTopicEventIds('sport:1')).toEqual([1]);
  });
});
