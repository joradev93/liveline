/**
 * Internal feed bus: feed-sim -> gateway / bet-api.
 *
 * On connect the consumer gets one `feed:snapshot`, then ordered `feed:batch` messages.
 * `seq` increases by one per message; a consumer that sees a gap must reconnect.
 */
import type { EventStatus, MarketStatus, SportEvent } from './domain';

export type FeedChange =
  | { k: 'price'; e: number; m: number; sel: Record<string, number>; ts: number }
  | { k: 'mst'; e: number; m: number; st: MarketStatus; ts: number }
  | { k: 'est'; e: number; st: EventStatus; sc?: [number, number]; ts: number }
  | { k: 'add'; event: SportEvent; ts: number }
  | { k: 'rm'; e: number; ts: number };

export interface FeedSnapshotMessage {
  t: 'feed:snapshot';
  seq: number;
  events: SportEvent[];
}

export interface FeedBatchMessage {
  t: 'feed:batch';
  seq: number;
  ts: number;
  changes: FeedChange[];
}

export type FeedMessage = FeedSnapshotMessage | FeedBatchMessage;

export const MIN_TICK_RATE = 50;
export const MAX_TICK_RATE = 2000;
