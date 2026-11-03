/**
 * Client <-> gateway WebSocket protocol.
 *
 * client -> server: { t:"sub", topics } | { t:"unsub", topics }
 * server -> client: snapshot | delta | error
 *
 * Versions are per topic and monotonic. A delta moves a client from `from` to `v`.
 * Ops carry absolute values (latest price / status), so a delta can be applied to any
 * state with version in [from, v). A client whose version is below `from` has missed
 * changes and must re-subscribe to get a fresh snapshot.
 */
import type { EventStatus, MarketStatus, SportEvent } from './domain.js';
import type { Topic } from './topics.js';

export interface SubMessage {
  t: 'sub';
  topics: Topic[];
}

export interface UnsubMessage {
  t: 'unsub';
  topics: Topic[];
}

export type ClientMessage = SubMessage | UnsubMessage;

/** Market update: changed prices and/or a status change. */
export interface MarketOp {
  m: number;
  sel?: Record<string, number>;
  st?: MarketStatus;
}

/** Event update: status and/or score change. */
export interface EventOp {
  e: number;
  est?: EventStatus;
  sc?: [number, number];
}

/** A new event joined the topic. */
export interface AddOp {
  add: SportEvent;
}

/** An event left the topic (settled and removed). */
export interface RemoveOp {
  rm: number;
}

export type DeltaOp = MarketOp | EventOp | AddOp | RemoveOp;

export interface SnapshotMessage {
  t: 'snapshot';
  topic: Topic;
  v: number;
  events: SportEvent[];
}

export interface DeltaMessage {
  t: 'delta';
  topic: Topic;
  from: number;
  v: number;
  ops: DeltaOp[];
  /** Feed timestamp (epoch ms) of the oldest change in this delta. */
  ts: number;
}

export interface ErrorMessage {
  t: 'error';
  code: 'BAD_MESSAGE' | 'UNKNOWN_TOPIC' | 'TOO_MANY_TOPICS';
  message: string;
}

export type ServerMessage = SnapshotMessage | DeltaMessage | ErrorMessage;

export const isMarketOp = (op: DeltaOp): op is MarketOp => 'm' in op;
export const isEventOp = (op: DeltaOp): op is EventOp => 'e' in op;
export const isAddOp = (op: DeltaOp): op is AddOp => 'add' in op;
export const isRemoveOp = (op: DeltaOp): op is RemoveOp => 'rm' in op;

/** Gap check used by clients: true when changes between the client version and `from` were missed. */
export function hasVersionGap(clientVersion: number, delta: Pick<DeltaMessage, 'from'>): boolean {
  return delta.from > clientVersion;
}

/** True when the delta is older than (or equal to) what the client already has. */
export function isStaleDelta(clientVersion: number, delta: Pick<DeltaMessage, 'v'>): boolean {
  return delta.v <= clientVersion;
}
