import { describe, expect, it } from 'vitest';
import { combineOdds, oddsToInt, roundOdds } from './odds';
import {
  clientMessageSchema,
  deltaOpSchema,
  placeBetRequestSchema,
  serverMessageSchema,
} from './schemas';
import { parseTopic } from './topics';
import { hasVersionGap, isStaleDelta } from './ws';

describe('topics', () => {
  it('parses sport and event topics', () => {
    expect(parseTopic('sport:1')).toEqual({ kind: 'sport', id: 1 });
    expect(parseTopic('event:42')).toEqual({ kind: 'event', id: 42 });
  });

  it('rejects anything else', () => {
    for (const bad of [
      'sport:',
      'sport:x',
      'league:1',
      'event:1:2',
      ' sport:1',
      'sport:1234567890',
    ]) {
      expect(parseTopic(bad)).toBeNull();
    }
  });
});

describe('client messages', () => {
  it('accepts sub and unsub', () => {
    expect(clientMessageSchema.parse({ t: 'sub', topics: ['sport:1', 'event:9'] }).t).toBe('sub');
    expect(clientMessageSchema.parse({ t: 'unsub', topics: ['event:9'] }).t).toBe('unsub');
  });

  it('rejects unknown types, empty and bad topics', () => {
    expect(clientMessageSchema.safeParse({ t: 'hello' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'sub', topics: [] }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'sub', topics: ['sport:abc'] }).success).toBe(false);
  });

  it('caps topics per message', () => {
    const topics = Array.from({ length: 51 }, (_, i) => `event:${i + 1}`);
    expect(clientMessageSchema.safeParse({ t: 'sub', topics }).success).toBe(false);
  });
});

describe('server messages', () => {
  it('accepts a delta with every op kind', () => {
    const msg = {
      t: 'delta',
      topic: 'sport:1',
      from: 3,
      v: 7,
      ts: 1_700_000_000_000,
      ops: [
        { m: 10, sel: { '1': 2.15, X: 3.3 } },
        { m: 11, st: 'suspended' },
        { e: 5, est: 'live', sc: [1, 0] },
        { rm: 6 },
      ],
    };
    expect(serverMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('rejects ops with unknown fields or bad prices', () => {
    expect(deltaOpSchema.safeParse({ m: 1, sel: { '1': 0.5 } }).success).toBe(false);
    expect(deltaOpSchema.safeParse({ m: 1, foo: 1 }).success).toBe(false);
  });
});

describe('versions', () => {
  it('detects a gap only when from is ahead of the client', () => {
    expect(hasVersionGap(5, { from: 5 })).toBe(false);
    expect(hasVersionGap(6, { from: 5 })).toBe(false); // absolute ops: safe to apply
    expect(hasVersionGap(4, { from: 5 })).toBe(true);
  });

  it('detects stale deltas', () => {
    expect(isStaleDelta(7, { v: 7 })).toBe(true);
    expect(isStaleDelta(6, { v: 7 })).toBe(false);
  });
});

describe('bet requests', () => {
  const leg = { eventId: 1, marketId: 2, sel: '1', odds: 2.1 };

  it('accepts a single and a multiple', () => {
    expect(
      placeBetRequestSchema.safeParse({
        type: 'single',
        stakeCents: 500,
        acceptChanges: 'none',
        legs: [leg],
      }).success,
    ).toBe(true);
    expect(
      placeBetRequestSchema.safeParse({
        type: 'multiple',
        stakeCents: 500,
        acceptChanges: 'higher',
        legs: [leg, { ...leg, eventId: 3, marketId: 4 }],
      }).success,
    ).toBe(true);
  });

  it('rejects leg count mismatches, bad stakes and policies', () => {
    const base = { type: 'single', stakeCents: 500, acceptChanges: 'none', legs: [leg] };
    expect(placeBetRequestSchema.safeParse({ ...base, legs: [leg, leg] }).success).toBe(false);
    expect(placeBetRequestSchema.safeParse({ ...base, type: 'multiple' }).success).toBe(false);
    expect(placeBetRequestSchema.safeParse({ ...base, stakeCents: 0 }).success).toBe(false);
    expect(placeBetRequestSchema.safeParse({ ...base, stakeCents: 1.5 }).success).toBe(false);
    expect(placeBetRequestSchema.safeParse({ ...base, acceptChanges: 'lower' }).success).toBe(
      false,
    );
  });
});

describe('odds', () => {
  it('rounds and clamps', () => {
    expect(roundOdds(2.149)).toBe(2.15);
    expect(roundOdds(0.5)).toBe(1.01);
    expect(oddsToInt(2.15)).toBe(215);
  });

  it('combines legs', () => {
    expect(combineOdds([2, 1.5])).toBe(3);
    expect(combineOdds([1.91, 1.91, 1.91])).toBe(6.97);
  });
});
