import type { DeltaOp, SportEvent, Topic } from '@liveline/protocol';

/** Main thread -> feed worker. */
export type ToWorker =
  | { type: 'connect'; url: string }
  | { type: 'sub'; topic: Topic }
  | { type: 'unsub'; topic: Topic };

/** Parsed, version-checked feed data, ready to apply to the store. */
export type FeedItem =
  | { kind: 'snapshot'; topic: Topic; events: SportEvent[] }
  | { kind: 'delta'; topic: Topic; ops: DeltaOp[] };

export interface FeedMetrics {
  connected: boolean;
  /** WebSocket messages received per second. */
  msgsPerSec: number;
  /** WebSocket payload bytes per second (UTF-8), in KB. */
  kbPerSec: number;
  /** Market/event ops applied per second (after coalescing). */
  opsPerSec: number;
  /** tick -> worker latency over the last 5 s, ms. Null until data arrives. */
  latencyP50: number | null;
  latencyP99: number | null;
  gaps: number;
  reconnects: number;
}

/** Feed worker -> main thread. */
export type FromWorker =
  | { type: 'batch'; items: FeedItem[] }
  | { type: 'metrics'; metrics: FeedMetrics }
  /** Events per sport id; sent on connect and when a count changes. */
  | { type: 'counts'; counts: Record<string, number> };
