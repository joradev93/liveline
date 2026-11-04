import type { SnapshotMessage, SportEvent } from '@liveline/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createSnapshotCache, firstRows } from './snapshot-cache';

const ev = (id: number, status: SportEvent['status'], start: number): SportEvent => ({
  id,
  sportId: 1,
  league: 'L',
  home: `H${id}`,
  away: `A${id}`,
  start,
  status,
  markets: [],
});

const snap = (events: SportEvent[]): SnapshotMessage => ({
  t: 'snapshot',
  topic: 'sport:1',
  v: 7,
  events,
});

describe('firstRows', () => {
  it('keeps the first rows in list order and the total count', () => {
    const s = snap([
      ev(1, 'prematch', 300),
      ev(2, 'settled', 50),
      ev(3, 'live', 200),
      ev(4, 'prematch', 100),
      ev(5, 'suspended', 150),
    ]);
    const first = firstRows(s, 3);
    expect(first.total).toBe(5);
    expect(first.snapshot.events.map((e) => e.id)).toEqual([5, 3, 4]);
    expect(first.snapshot.v).toBe(7);
  });
});

describe('createSnapshotCache', () => {
  it('shares one load per sport within the TTL, also between concurrent calls', async () => {
    let t = 0;
    const load = vi.fn(async () => snap([ev(1, 'live', 1)]));
    const get = createSnapshotCache(load, 1_000, () => t);
    const [a, b] = await Promise.all([get(1), get(1)]);
    expect(a).toBe(b);
    t = 999;
    await get(1);
    expect(load).toHaveBeenCalledTimes(1);
    await get(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('loads again after the TTL', async () => {
    let t = 0;
    const load = vi.fn(async () => snap([ev(1, 'live', 1)]));
    const get = createSnapshotCache(load, 1_000, () => t);
    await get(1);
    t = 1_000;
    await get(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed load', async () => {
    const load = vi
      .fn<(id: number) => Promise<SnapshotMessage | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(snap([ev(1, 'live', 1)]));
    const get = createSnapshotCache(load, 1_000, () => 0);
    expect(await get(1)).toBeNull();
    expect((await get(1))?.total).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
