import {
  hasVersionGap,
  isStaleDelta,
  type DeltaOp,
  type Market,
  type ServerMessage,
  type SportEvent,
  type Topic,
} from '@liveline/protocol';
import type { Subscriber, TopicHub } from './hub.js';

const decoder = new TextDecoder();

/** In-memory subscriber that records what the hub sent. */
export class FakeSubscriber implements Subscriber {
  readonly topics = new Map<Topic, number>();
  readonly received: ServerMessage[] = [];
  buffered = 0;

  send(payload: Uint8Array): void {
    this.received.push(JSON.parse(decoder.decode(payload)) as ServerMessage);
  }
  bufferedAmount(): number {
    return this.buffered;
  }
  cork(fn: () => void): void {
    fn();
  }
  take(): ServerMessage[] {
    return this.received.splice(0);
  }
}

/**
 * Client-side copy of one topic, built only from snapshots and deltas, the way the web
 * client does it. On a version gap it resubscribes (client-driven resync).
 */
export class Replica {
  readonly events = new Map<number, SportEvent>();
  version = -1;
  gaps = 0;

  constructor(
    private readonly hub: TopicHub,
    readonly sub: FakeSubscriber,
    readonly topic: Topic,
  ) {}

  subscribe(): void {
    this.hub.subscribe(this.sub, this.topic);
    this.drain();
  }

  drain(): void {
    for (const msg of this.sub.take()) {
      if (msg.t === 'error' || msg.topic !== this.topic) continue;
      if (msg.t === 'snapshot') {
        this.events.clear();
        for (const e of msg.events) this.events.set(e.id, e);
        this.version = msg.v;
        continue;
      }
      if (isStaleDelta(this.version, msg)) continue;
      if (hasVersionGap(this.version, msg)) {
        this.gaps++;
        this.subscribe();
        return;
      }
      for (const op of msg.ops) this.apply(op);
      this.version = msg.v;
    }
  }

  private apply(op: DeltaOp): void {
    if ('add' in op) this.events.set(op.add.id, op.add);
    else if ('rm' in op) this.events.delete(op.rm);
    else if ('e' in op) {
      const event = this.events.get(op.e);
      if (!event) return;
      if (op.est) event.status = op.est;
      if (op.sc) event.score = op.sc;
    } else {
      const market = this.findMarket(op.m);
      if (!market) return;
      if (op.st) market.status = op.st;
      if (op.sel) for (const s of market.sel) if (op.sel[s.k] !== undefined) s.p = op.sel[s.k]!;
    }
  }

  private findMarket(id: number): Market | undefined {
    for (const e of this.events.values()) {
      const m = e.markets.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  }

  sorted(): SportEvent[] {
    return [...this.events.values()].sort((a, b) => a.id - b.id);
  }
}

export function event(id: number, sportId: number, marketIds: number[]): SportEvent {
  return {
    id,
    sportId,
    league: 'Test League',
    home: `Home ${id}`,
    away: `Away ${id}`,
    start: 0,
    status: 'live',
    score: [0, 0],
    markets: marketIds.map((mid, i) => ({
      id: mid,
      eventId: id,
      type: 'match-result',
      name: `Market ${mid}`,
      status: 'open',
      main: i < 3,
      sel: [
        { k: '1', name: 'Home', p: 2 },
        { k: 'X', name: 'Draw', p: 3 },
        { k: '2', name: 'Away', p: 4 },
      ],
    })),
  };
}
