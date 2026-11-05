import type { SnapshotMessage } from '@liveline/protocol';
import { compareEvents } from './store';

/** What the server render needs from a sport snapshot. */
export interface FirstPaintSnapshot {
  /** Number of events in the topic (shown in the heading). */
  total: number;
  /**
   * The first rows in list order. The browser gets the full snapshot over the WebSocket right
   * after hydration, so sending every event in the HTML (and again in the RSC payload) is waste.
   */
  snapshot: SnapshotMessage;
}

/** Keep the rows a tall first screen shows, plus the list overscan. */
export const FIRST_PAINT_ROWS = 30;

export function firstRows(snapshot: SnapshotMessage, rows = FIRST_PAINT_ROWS): FirstPaintSnapshot {
  const events = [...snapshot.events].sort(compareEvents).slice(0, rows);
  return { total: snapshot.events.length, snapshot: { ...snapshot, events } };
}

/**
 * Cache for the server render: at most one load per key per `ttlMs`, shared by all page requests
 * in that window (also by concurrent ones). A failed load (null) is not kept, so the next request
 * tries again. No stale entries are served.
 */
export function createTtlCache<K, V>(
  load: (key: K) => Promise<V | null>,
  ttlMs: number,
  now: () => number = Date.now,
) {
  const entries = new Map<K, { at: number; value: Promise<V | null> }>();
  return (key: K): Promise<V | null> => {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const entry = { at: now(), value: load(key) };
    entries.set(key, entry);
    void entry.value.then((v) => {
      if (v === null && entries.get(key) === entry) entries.delete(key);
    });
    return entry.value;
  };
}

type Load = (sportId: number) => Promise<SnapshotMessage | null>;

/**
 * Per-sport snapshot cache for the server render (see `createTtlCache`). Odds move every second,
 * and the WebSocket replaces this snapshot right after hydration anyway.
 */
export function createSnapshotCache(load: Load, ttlMs: number, now: () => number = Date.now) {
  return createTtlCache(
    (sportId: number) => load(sportId).then((s) => (s ? firstRows(s) : null)),
    ttlMs,
    now,
  );
}
