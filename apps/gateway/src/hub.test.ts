import type { DeltaMessage, FeedChange, SnapshotMessage } from '@liveline/protocol';
import { FeedSimulator } from '@liveline/feed-sim';
import { describe, expect, it } from 'vitest';
import { TopicHub } from './hub.js';
import { MarketState } from './state.js';
import { event, FakeSubscriber, Replica } from './test-utils.js';

const T = 1_000;

function setup(highWaterMark = 1024) {
  const state = new MarketState();
  // Event 1: 4 markets (3 main + 1 extra), event 2: 3 main markets. Both football.
  state.reset([event(1, 1, [11, 12, 13, 14]), event(2, 1, [21, 22, 23])]);
  const hub = new TopicHub(state, { highWaterMark, maxTopicsPerClient: 3 });
  const apply = (change: FeedChange) => state.apply(change, hub.record);
  return { state, hub, apply };
}

const price = (m: number, sel: Record<string, number>, ts = T): FeedChange => ({
  k: 'price',
  e: 0,
  m,
  sel,
  ts,
});

describe('subscribe', () => {
  it('sends a snapshot; sport topics carry main markets only', () => {
    const { hub } = setup();
    const sub = new FakeSubscriber();
    expect(hub.subscribe(sub, 'sport:1')).toBe('ok');
    const [snap] = sub.take() as SnapshotMessage[];
    expect(snap?.t).toBe('snapshot');
    expect(snap?.events.map((e) => e.markets.length)).toEqual([3, 3]);

    hub.subscribe(sub, 'event:1');
    const [eventSnap] = sub.take() as SnapshotMessage[];
    expect(eventSnap?.events[0]?.markets).toHaveLength(4);
  });

  it('rejects unknown topics and enforces the per-client topic limit', () => {
    const { hub } = setup();
    const sub = new FakeSubscriber();
    expect(hub.subscribe(sub, 'event:999')).toBe('unknown-topic');
    expect(hub.subscribe(sub, 'sport:99')).toBe('unknown-topic');
    expect(hub.subscribe(sub, 'sport:1')).toBe('ok');
    expect(hub.subscribe(sub, 'sport:2')).toBe('ok');
    expect(hub.subscribe(sub, 'event:1')).toBe('ok');
    expect(hub.subscribe(sub, 'event:2')).toBe('too-many-topics');
  });

  it('counts a repeated subscription as a resync and sends a fresh snapshot', () => {
    const { hub } = setup();
    const sub = new FakeSubscriber();
    hub.subscribe(sub, 'sport:1');
    hub.subscribe(sub, 'sport:1');
    expect(sub.take().map((m) => m.t)).toEqual(['snapshot', 'snapshot']);
    expect(hub.stats.resyncs).toBe(1);
  });
});

describe('coalescing', () => {
  it('keeps only the latest price per selection within one flush', () => {
    const { hub, apply } = setup();
    const sub = new FakeSubscriber();
    hub.subscribe(sub, 'sport:1');
    const snapV = (sub.take()[0] as SnapshotMessage).v;

    apply(price(11, { '1': 2.1, X: 3.1 }, T));
    apply(price(11, { '1': 2.2 }, T + 5));
    apply(price(11, { '1': 2.3 }, T + 9));
    apply({ k: 'mst', e: 1, m: 12, st: 'suspended', ts: T + 7 });
    hub.flush();

    const [delta] = sub.take() as DeltaMessage[];
    expect(delta).toMatchObject({ t: 'delta', topic: 'sport:1', from: snapV });
    expect(delta?.v).toBe(snapV + 4);
    expect(delta?.ts).toBe(T); // oldest change in the window
    expect(delta?.ops).toEqual([
      { m: 11, sel: { '1': 2.3, X: 3.1 } },
      { m: 12, st: 'suspended' },
    ]);
  });

  it('routes non-main markets only to the event topic', () => {
    const { hub, apply } = setup();
    const sportSub = new FakeSubscriber();
    const eventSub = new FakeSubscriber();
    hub.subscribe(sportSub, 'sport:1');
    hub.subscribe(eventSub, 'event:1');
    sportSub.take();
    eventSub.take();

    apply(price(14, { '1': 5 }));
    hub.flush();
    expect(sportSub.take()).toEqual([]);
    expect((eventSub.take()[0] as DeltaMessage).ops).toEqual([{ m: 14, sel: { '1': 5 } }]);
  });

  it('merges event status and score updates', () => {
    const { hub, apply } = setup();
    const sub = new FakeSubscriber();
    hub.subscribe(sub, 'sport:1');
    sub.take();
    apply({ k: 'est', e: 1, st: 'suspended', sc: [1, 0], ts: T });
    apply({ k: 'est', e: 1, st: 'live', ts: T + 1 });
    hub.flush();
    expect((sub.take()[0] as DeltaMessage).ops).toEqual([{ e: 1, est: 'live', sc: [1, 0] }]);
  });

  it('serializes a delta once and sends the same bytes to every subscriber', () => {
    const { hub, apply } = setup();
    const payloads: Uint8Array[] = [];
    const subs = [new FakeSubscriber(), new FakeSubscriber()];
    for (const sub of subs) {
      hub.subscribe(sub, 'sport:1');
      sub.send = (p) => void payloads.push(p);
    }
    apply(price(11, { '1': 2.5 }));
    hub.flush();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(payloads[1]);
  });

  it('sends nothing when there are no changes, and ignores topics without subscribers', () => {
    const { hub, apply } = setup();
    const sub = new FakeSubscriber();
    hub.subscribe(sub, 'event:2');
    sub.take();
    apply(price(11, { '1': 2.5 })); // event 1: nobody listens
    hub.flush();
    hub.flush();
    expect(sub.take()).toEqual([]);
    expect(hub.stats.topics).toBe(1);
  });

  it('does not send a delta that is not newer than the snapshot the client just got', () => {
    const { hub, apply } = setup();
    const early = new FakeSubscriber();
    hub.subscribe(early, 'sport:1');
    apply(price(11, { '1': 2.5 }));
    hub.flush(); // invalidates the snapshot cache
    apply(price(21, { '1': 1.7 }));
    const late = new FakeSubscriber();
    hub.subscribe(late, 'sport:1'); // fresh snapshot already includes the second change
    late.take();
    hub.flush();
    expect(late.take()).toEqual([]);
    expect(early.take().map((m) => m.t)).toEqual(['snapshot', 'delta', 'delta']);
  });
});

describe('snapshot inside a flush window', () => {
  it('a client that subscribes mid-window applies the next delta without a gap', () => {
    const { hub, apply, state } = setup();
    apply(price(11, { '1': 9 })); // no topic yet: ignored by the hub
    const first = new FakeSubscriber();
    hub.subscribe(first, 'sport:1');
    apply(price(11, { '1': 2.5 }));
    const replica = new Replica(hub, new FakeSubscriber(), 'sport:1');
    replica.subscribe(); // snapshot at v=c, while one op is pending
    apply(price(21, { '2': 7 }));
    hub.flush();
    replica.drain();
    expect(replica.gaps).toBe(0);
    expect(replica.sorted()).toEqual(state.snapshot({ kind: 'sport', id: 1 }));
  });
});

describe('backpressure', () => {
  it('skips deltas for a slow client; the client resyncs on the version gap', () => {
    const { hub, apply, state } = setup(1024);
    const replica = new Replica(hub, new FakeSubscriber(), 'sport:1');
    replica.subscribe();

    replica.sub.buffered = 10_000; // over the high-water mark
    apply(price(11, { '1': 2.5 }));
    hub.flush();
    expect(replica.sub.received).toEqual([]);
    expect(hub.stats.deltasSkipped).toBe(1);

    replica.sub.buffered = 0; // drained
    apply(price(21, { '1': 1.5 }));
    hub.flush();
    expect(hub.stats.gapsSent).toBe(1);
    replica.drain();
    expect(replica.gaps).toBe(1);
    expect(hub.stats.resyncs).toBe(1);
    expect(replica.sorted()).toEqual(state.snapshot({ kind: 'sport', id: 1 }));
  });

  it('pushes a snapshot to a drained client when no newer delta would reveal its gap', () => {
    const { hub, apply, state } = setup(1024);
    const replica = new Replica(hub, new FakeSubscriber(), 'event:1');
    replica.subscribe();
    replica.sub.buffered = 10_000;
    apply(price(14, { '1': 6 }));
    hub.flush(); // skipped
    replica.sub.buffered = 0;
    hub.flush(); // quiet topic: no new delta
    replica.drain();
    expect(hub.stats.catchUps).toBe(1);
    expect(replica.sorted()).toEqual(state.snapshot({ kind: 'event', id: 1 }));
  });
});

describe('feed reset', () => {
  it('resyncAll sends fresh snapshots with a higher version and drops vanished event topics', () => {
    const { hub, state } = setup();
    const sub = new FakeSubscriber();
    hub.subscribe(sub, 'sport:1');
    hub.subscribe(sub, 'event:2');
    const before = (sub.take()[0] as SnapshotMessage).v;

    state.reset([event(1, 1, [11, 12, 13])]); // event 2 is gone
    hub.resyncAll();
    const msgs = sub.take() as SnapshotMessage[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.topic).toBe('sport:1');
    expect(msgs[0]!.v).toBeGreaterThan(before);
    expect([...sub.topics.keys()]).toEqual(['sport:1']);
  });
});

describe('replica consistency under a random feed', () => {
  it('snapshot + deltas reproduce the server state, with random backpressure and resyncs', () => {
    let now = 1_700_000_000_000;
    const sim = new FeedSimulator({ seed: 99, eventCount: 120, liveDurationMs: 30_000 }, now);
    const state = new MarketState();
    state.reset(structuredClone(sim.snapshot()));
    const hub = new TopicHub(state, { highWaterMark: 1024, maxTopicsPerClient: 50 });

    const replicas = [1, 2, 3].map((id) => new Replica(hub, new FakeSubscriber(), `sport:${id}`));
    const eventIds = state
      .snapshot({ kind: 'sport', id: 1 })
      .slice(0, 3)
      .map((e) => e.id);
    replicas.push(...eventIds.map((id) => new Replica(hub, new FakeSubscriber(), `event:${id}`)));
    for (const r of replicas) r.subscribe();

    let flips = 0;
    for (let step = 0; step < 600; step++) {
      now += 100;
      const changes: FeedChange[] = [];
      for (let i = 0; i < 30; i++) {
        const c = sim.tick(now);
        if (c) changes.push(c);
      }
      changes.push(...sim.advance(now));
      for (const c of structuredClone(changes)) state.apply(c, hub.record);

      for (const r of replicas) {
        const slow = (step * 7 + r.topic.length * 13) % 11 === 0;
        r.sub.buffered = slow ? 5_000 : 0;
        if (slow) flips++;
      }
      hub.flush();
      for (const r of replicas) {
        r.sub.buffered = 0;
        r.drain();
      }
    }
    hub.flush();
    for (const r of replicas) r.drain();

    expect(flips).toBeGreaterThan(0);
    expect(hub.stats.deltasSkipped).toBeGreaterThan(0);
    for (const r of replicas) {
      const parsed = r.topic.startsWith('sport')
        ? ({ kind: 'sport', id: Number(r.topic.slice(6)) } as const)
        : ({ kind: 'event', id: Number(r.topic.slice(6)) } as const);
      const expected = [...state.snapshot(parsed)].sort((a, b) => a.id - b.id);
      expect(r.sorted()).toEqual(expected);
    }
  });
});
