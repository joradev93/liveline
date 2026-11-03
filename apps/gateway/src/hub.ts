import {
  parseTopic,
  type DeltaMessage,
  type DeltaOp,
  type ParsedTopic,
  type SnapshotMessage,
  type Topic,
} from '@liveline/protocol';
import type { MarketState } from './state.js';

/** One connected client, as the hub sees it. The uWS layer adapts real sockets to this. */
export interface Subscriber {
  /** topic -> version of the last snapshot/delta sent to this client. */
  readonly topics: Map<Topic, number>;
  send(payload: Uint8Array): void;
  bufferedAmount(): number;
  cork(fn: () => void): void;
}

interface TopicEntry {
  readonly name: Topic;
  readonly parsed: ParsedTopic;
  /** Version after the last recorded op. */
  v: number;
  /** Version the last flushed delta moved clients to. */
  flushedV: number;
  /** Coalesced ops since the last flush, keyed by market / event. Insertion order is kept. */
  readonly pending: Map<string, DeltaOp>;
  /** Feed timestamp of the oldest pending change. */
  oldestTs: number;
  readonly subscribers: Set<Subscriber>;
  /** Snapshot built after the last flush; valid until the next flush (see `snapshotFor`). */
  snapshot?: { v: number; payload: Uint8Array };
}

export type SubscribeResult = 'ok' | 'unknown-topic' | 'too-many-topics';

export interface HubOptions {
  /** Skip deltas for a client whose socket buffer is above this many bytes. */
  highWaterMark: number;
  maxTopicsPerClient: number;
}

export interface HubStats {
  topics: number;
  deltasSent: number;
  snapshotsSent: number;
  bytesSent: number;
  /** Deltas not sent because the client was over the high-water mark. */
  deltasSkipped: number;
  /** Deltas sent to a client that had missed earlier ones; the client will resync. */
  gapsSent: number;
  /** Subscriptions to a topic the client already had (client-driven resync). */
  resyncs: number;
  /** Snapshots pushed to a client that was skipped and then drained, on a topic with no newer delta. */
  catchUps: number;
  flushes: number;
  lastFlushMs: number;
  maxFlushMs: number;
}

const encoder = new TextEncoder();
const encode = (msg: SnapshotMessage | DeltaMessage) => encoder.encode(JSON.stringify(msg));

const opKey = (op: DeltaOp): string =>
  'm' in op ? `m${op.m}` : 'e' in op ? `e${op.e}` : 'add' in op ? `a${op.add.id}` : `r${op.rm}`;

/**
 * Topic subscriptions, versions and per-topic coalescing.
 *
 * Ops are recorded as feed changes arrive. Every `flush()` (100 ms in production) each
 * topic with pending ops becomes one delta that keeps only the latest value per market,
 * is serialized once, and is sent to every subscriber that can take it.
 *
 * Versions come from one gateway-wide counter, so they are monotonic per topic even when
 * a topic is dropped (no subscribers) and created again.
 */
export class TopicHub {
  private clock = 0;
  private readonly topics = new Map<Topic, TopicEntry>();
  /** Clients that had deltas skipped and may be behind on some topics. */
  private readonly lagging = new Set<Subscriber>();
  private readonly counters = {
    deltasSent: 0,
    snapshotsSent: 0,
    bytesSent: 0,
    deltasSkipped: 0,
    gapsSent: 0,
    resyncs: 0,
    catchUps: 0,
    flushes: 0,
    lastFlushMs: 0,
    maxFlushMs: 0,
  };

  constructor(
    private readonly state: MarketState,
    private readonly opts: HubOptions,
  ) {}

  get stats(): HubStats {
    return { topics: this.topics.size, ...this.counters };
  }

  subscribe(sub: Subscriber, topic: Topic): SubscribeResult {
    const parsed = parseTopic(topic);
    if (!parsed || !this.state.exists(parsed)) return 'unknown-topic';
    const already = sub.topics.has(topic);
    if (!already && sub.topics.size >= this.opts.maxTopicsPerClient) return 'too-many-topics';
    if (already) this.counters.resyncs++;

    const entry = this.entry(topic, parsed);
    entry.subscribers.add(sub);
    const snapshot = this.snapshotFor(entry);
    sub.topics.set(topic, snapshot.v);
    sub.send(snapshot.payload);
    this.counters.snapshotsSent++;
    this.counters.bytesSent += snapshot.payload.byteLength;
    return 'ok';
  }

  unsubscribe(sub: Subscriber, topic: Topic): void {
    sub.topics.delete(topic);
    const entry = this.topics.get(topic);
    if (!entry) return;
    entry.subscribers.delete(sub);
    if (entry.subscribers.size === 0) this.topics.delete(topic);
  }

  /** Forget a disconnected client. */
  drop(sub: Subscriber): void {
    this.lagging.delete(sub);
    for (const topic of [...sub.topics.keys()]) this.unsubscribe(sub, topic);
  }

  /** Record one op for a topic. Ops for topics nobody listens to are ignored. */
  readonly record = (topic: Topic, op: DeltaOp, ts: number): void => {
    const entry = this.topics.get(topic);
    if (!entry) return;
    entry.v = ++this.clock;
    if (ts < entry.oldestTs) entry.oldestTs = ts;

    const key = opKey(op);
    const existing = entry.pending.get(key);
    if (!existing) {
      // Copy: the same op object is recorded for the sport and the event topic.
      entry.pending.set(key, 'sel' in op && op.sel ? { ...op, sel: { ...op.sel } } : { ...op });
    } else if ('m' in op && 'm' in existing) {
      if (op.sel) existing.sel = { ...existing.sel, ...op.sel };
      if (op.st) existing.st = op.st;
    } else if ('e' in op && 'e' in existing) {
      if (op.est) existing.est = op.est;
      if (op.sc) existing.sc = op.sc;
    } else {
      entry.pending.set(key, op);
    }
  };

  /** Build one delta per changed topic and send it to every subscriber that can take it. */
  flush(): void {
    const started = performance.now();
    const ready = new Map<Topic, { payload: Uint8Array; from: number; v: number }>();
    const receivers = new Set<Subscriber>(this.lagging);

    for (const entry of this.topics.values()) {
      if (entry.pending.size === 0) continue;
      const msg: DeltaMessage = {
        t: 'delta',
        topic: entry.name,
        from: entry.flushedV,
        v: entry.v,
        ops: [...entry.pending.values()],
        ts: entry.oldestTs,
      };
      ready.set(entry.name, { payload: encode(msg), from: msg.from, v: msg.v });
      entry.flushedV = entry.v;
      entry.pending.clear();
      entry.oldestTs = Infinity;
      entry.snapshot = undefined;
      for (const sub of entry.subscribers) receivers.add(sub);
    }

    for (const sub of receivers) {
      if (sub.bufferedAmount() > this.opts.highWaterMark) {
        // Slow client: skip intermediate deltas. Its version stays behind; the next delta
        // it gets has `from` above its version, so the client resyncs.
        for (const topic of sub.topics.keys()) if (ready.has(topic)) this.counters.deltasSkipped++;
        this.lagging.add(sub);
        continue;
      }
      this.lagging.delete(sub);
      sub.cork(() => this.deliver(sub, ready));
    }
    const took = performance.now() - started;
    this.counters.flushes++;
    this.counters.lastFlushMs = took;
    if (took > this.counters.maxFlushMs) this.counters.maxFlushMs = took;
  }

  private deliver(
    sub: Subscriber,
    ready: Map<Topic, { payload: Uint8Array; from: number; v: number }>,
  ): void {
    for (const [topic, sentV] of sub.topics) {
      const delta = ready.get(topic);
      if (delta) {
        if (sentV >= delta.v) continue;
        if (sentV < delta.from) this.counters.gapsSent++;
        sub.send(delta.payload);
        sub.topics.set(topic, delta.v);
        this.counters.deltasSent++;
        this.counters.bytesSent += delta.payload.byteLength;
        continue;
      }
      // No new delta on this topic, but the client missed one earlier: nothing would reveal
      // the gap, so push a fresh snapshot now.
      const entry = this.topics.get(topic);
      if (entry && sentV < entry.flushedV) {
        const snapshot = this.snapshotFor(entry);
        sub.send(snapshot.payload);
        sub.topics.set(topic, snapshot.v);
        this.counters.catchUps++;
        this.counters.snapshotsSent++;
        this.counters.bytesSent += snapshot.payload.byteLength;
      }
    }
  }

  /** After the feed was rebuilt: drop pending ops and send every subscriber a fresh snapshot. */
  resyncAll(): void {
    for (const entry of this.topics.values()) {
      entry.pending.clear();
      entry.oldestTs = Infinity;
      entry.snapshot = undefined;
      entry.v = entry.flushedV = ++this.clock;
      if (!this.state.exists(entry.parsed)) {
        for (const sub of [...entry.subscribers]) this.unsubscribe(sub, entry.name);
        continue;
      }
      const snapshot = this.snapshotFor(entry);
      for (const sub of entry.subscribers) {
        sub.topics.set(entry.name, snapshot.v);
        sub.send(snapshot.payload);
        this.counters.snapshotsSent++;
        this.counters.bytesSent += snapshot.payload.byteLength;
      }
    }
  }

  /** Serialized snapshot for HTTP (server-side rendering). Null for unknown topics. */
  snapshotPayload(topic: Topic): Uint8Array | null {
    const parsed = parseTopic(topic);
    if (!parsed || !this.state.exists(parsed)) return null;
    const entry = this.topics.get(topic);
    if (entry) return this.snapshotFor(entry).payload;
    return encode({ t: 'snapshot', topic, v: this.clock, events: this.state.snapshot(parsed) });
  }

  private entry(topic: Topic, parsed: ParsedTopic): TopicEntry {
    let entry = this.topics.get(topic);
    if (!entry) {
      entry = {
        name: topic,
        parsed,
        v: this.clock,
        flushedV: this.clock,
        pending: new Map(),
        oldestTs: Infinity,
        subscribers: new Set(),
      };
      this.topics.set(topic, entry);
    }
    return entry;
  }

  /**
   * Snapshots are cached until the next flush. A cached snapshot at version c (built after
   * the last flush, so flushedV <= c) stays correct: the next delta has from = flushedV <= c
   * and carries absolute values, so it moves a client at c to the new version.
   */
  private snapshotFor(entry: TopicEntry): { v: number; payload: Uint8Array } {
    if (!entry.snapshot) {
      const events = this.state.snapshot(entry.parsed);
      entry.snapshot = {
        v: entry.v,
        payload: encode({ t: 'snapshot', topic: entry.name, v: entry.v, events }),
      };
    }
    return entry.snapshot;
  }
}
