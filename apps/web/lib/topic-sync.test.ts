import type { DeltaMessage, SnapshotMessage } from '@liveline/protocol';
import { describe, expect, it } from 'vitest';
import { TopicSync } from './topic-sync';

const snapshot = (v: number): SnapshotMessage => ({
  t: 'snapshot',
  topic: 'sport:1',
  v,
  events: [],
});
const delta = (from: number, v: number, ts = 1000): DeltaMessage => ({
  t: 'delta',
  topic: 'sport:1',
  from,
  v,
  ops: [{ m: 1, sel: { '1': 2 } }],
  ts,
});

describe('TopicSync', () => {
  it('asks for a subscription only once per topic', () => {
    const sync = new TopicSync();
    expect(sync.want('sport:1')).toBe(true);
    expect(sync.want('sport:1')).toBe(false);
  });

  it('applies a snapshot, then deltas in order, and reports latency', () => {
    const sync = new TopicSync();
    sync.want('sport:1');
    expect(sync.handle(snapshot(10), 0).action).toBe('apply');
    const result = sync.handle(delta(10, 15, 1000), 1080);
    expect(result).toMatchObject({ action: 'apply', latencyMs: 80 });
    expect(sync.handle(delta(15, 20), 0).action).toBe('apply');
  });

  it('applies a delta whose from is below the client version (absolute ops)', () => {
    const sync = new TopicSync();
    sync.want('sport:1');
    sync.handle(snapshot(12), 0);
    expect(sync.handle(delta(10, 15), 0).action).toBe('apply');
  });

  it('ignores stale deltas and deltas before the first snapshot', () => {
    const sync = new TopicSync();
    sync.want('sport:1');
    expect(sync.handle(delta(0, 5), 0).action).toBe('ignore');
    sync.handle(snapshot(10), 0);
    expect(sync.handle(delta(5, 10), 0).action).toBe('ignore');
  });

  it('resubscribes on a gap and waits for the new snapshot', () => {
    const sync = new TopicSync();
    sync.want('sport:1');
    sync.handle(snapshot(10), 0);
    expect(sync.handle(delta(12, 15), 0)).toEqual({ action: 'resubscribe', topic: 'sport:1' });
    expect(sync.gaps).toBe(1);
    expect(sync.handle(delta(15, 18), 0).action).toBe('ignore'); // still waiting
    expect(sync.handle(snapshot(18), 0).action).toBe('apply');
  });

  it('ignores topics that were dropped and resets all on reconnect', () => {
    const sync = new TopicSync();
    sync.want('sport:1');
    sync.want('event:7');
    sync.drop('event:7');
    expect(sync.handle({ ...snapshot(1), topic: 'event:7' }, 0).action).toBe('ignore');
    expect(sync.resetAll()).toEqual(['sport:1']);
  });
});
