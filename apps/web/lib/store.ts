import {
  sportTopic,
  type DeltaOp,
  type EventStatus,
  type MarketStatus,
  type MarketType,
  type Selection,
  type SportEvent,
  type Topic,
} from '@liveline/protocol';
import type { FeedItem } from './worker-protocol';

export interface EventView {
  id: number;
  sportId: number;
  league: string;
  home: string;
  away: string;
  start: number;
  status: EventStatus;
  score?: [number, number];
  /** Main market ids (always known). */
  main: number[];
  /** All market ids, known once the event topic was received. */
  all?: number[];
}

export interface MarketView {
  id: number;
  eventId: number;
  type: MarketType;
  name: string;
  line?: number;
  status: MarketStatus;
  main: boolean;
  sel: readonly Selection[];
}

/** The part of a market that does not change on price ticks. Same object until the shape changes. */
export interface MarketShape {
  type: MarketType;
  name: string;
  line?: number;
  sel: readonly { k: string; name: string }[];
}

type Listener = () => void;

const STATUS_ORDER: Record<EventStatus, number> = {
  live: 0,
  suspended: 0,
  prematch: 1,
  settled: 2,
};

/** List order: live first, then upcoming by start time, ended last. Shared with the server render. */
export function compareEvents(
  a: Pick<SportEvent, 'id' | 'status' | 'start'>,
  b: Pick<SportEvent, 'id' | 'status' | 'start'>,
): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.start - b.start || a.id - b.id;
}

/** Store keys: one per market, per event and per topic list. Components subscribe to exactly one. */
export const marketKey = (id: number) => `m:${id}`;
export const eventKey = (id: number) => `e:${id}`;
export const topicKey = (topic: Topic) => `t:${topic}`;

/**
 * Normalized live state for the UI.
 *
 * Objects are immutable: a changed market or event gets a new object, so
 * `useSyncExternalStore` selectors re-render only the components whose slice changed.
 * Listeners are keyed per market / event / topic and notified once per applied batch.
 */
export class LiveStore {
  private readonly events = new Map<number, EventView>();
  private readonly markets = new Map<number, MarketView>();
  private readonly shapes = new Map<number, MarketShape>();
  private readonly topicEvents = new Map<Topic, Set<number>>();
  /** How many topics reference each event; at 0 the event and its markets are dropped. */
  private readonly refs = new Map<number, number>();
  private readonly sorted = new Map<Topic, number[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly dirty = new Set<string>();

  subscribe = (key: string, listener: Listener): (() => void) => {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  };

  getEvent = (id: number): EventView | undefined => this.events.get(id);
  getMarket = (id: number): MarketView | undefined => this.markets.get(id);

  getMarketShape = (id: number): MarketShape | undefined => this.shapes.get(id);

  getPrice = (marketId: number, k: string): number | undefined =>
    this.markets.get(marketId)?.sel.find((s) => s.k === k)?.p;

  /** Event ids of a topic: live first, then upcoming by start time. Stable array until it changes. */
  getTopicEventIds = (topic: Topic): number[] => {
    let ids = this.sorted.get(topic);
    if (!ids) {
      const set = this.topicEvents.get(topic);
      ids = set ? [...set].sort(this.compareIds) : EMPTY;
      this.sorted.set(topic, ids);
    }
    return ids;
  };

  hasTopic(topic: Topic): boolean {
    return this.topicEvents.has(topic);
  }

  /** Apply worker items, then notify each affected key once. */
  applyItems(items: readonly FeedItem[]): void {
    for (const item of items) {
      if (item.kind === 'snapshot') this.applySnapshot(item.topic, item.events);
      else this.applyDelta(item.topic, item.ops);
    }
    this.notify();
  }

  /**
   * Load a snapshot. `silent` is for seeding the store during render (server snapshot):
   * no listeners are called then.
   */
  loadSnapshot(topic: Topic, events: readonly SportEvent[], { silent = false } = {}): void {
    this.applySnapshot(topic, events);
    if (silent) this.dirty.clear();
    else this.notify();
  }

  dropTopic(topic: Topic): void {
    const set = this.topicEvents.get(topic);
    if (!set) return;
    for (const id of set) this.deref(id);
    this.topicEvents.delete(topic);
    this.sorted.delete(topic);
    this.dirty.add(topicKey(topic));
    this.notify();
  }

  private applySnapshot(topic: Topic, events: readonly SportEvent[]): void {
    const isEventTopic = topic.startsWith('event:');
    const previous = this.topicEvents.get(topic) ?? new Set<number>();
    const next = new Set<number>();
    for (const event of events) {
      this.upsertEvent(event, isEventTopic);
      next.add(event.id);
      if (!previous.has(event.id)) this.ref(event.id);
    }
    for (const id of previous) if (!next.has(id)) this.deref(id);
    this.topicEvents.set(topic, next);
    this.sorted.delete(topic);
    this.dirty.add(topicKey(topic));
  }

  private applyDelta(topic: Topic, ops: readonly DeltaOp[]): void {
    for (const op of ops) {
      if ('m' in op) {
        const market = this.markets.get(op.m);
        if (!market) continue;
        let sel = market.sel;
        if (op.sel) {
          const prices = op.sel;
          sel = market.sel.map((s) =>
            prices[s.k] !== undefined && prices[s.k] !== s.p ? { ...s, p: prices[s.k]! } : s,
          );
        }
        const status = op.st ?? market.status;
        if (status === market.status && sel.every((s, i) => s === market.sel[i])) continue;
        this.markets.set(market.id, { ...market, sel, status });
        this.dirty.add(marketKey(market.id));
      } else if ('e' in op) {
        const event = this.events.get(op.e);
        if (!event) continue;
        const updated: EventView = {
          ...event,
          status: op.est ?? event.status,
          score: op.sc ?? event.score,
        };
        this.events.set(event.id, updated);
        this.dirty.add(eventKey(event.id));
        if (updated.status !== event.status) this.invalidateSort(event.sportId, topic);
      } else if ('add' in op) {
        const set = this.topicEvents.get(topic);
        if (!set || set.has(op.add.id)) continue;
        this.upsertEvent(op.add, topic.startsWith('event:'));
        set.add(op.add.id);
        this.ref(op.add.id);
        this.invalidateSort(op.add.sportId, topic);
      } else {
        const set = this.topicEvents.get(topic);
        if (!set?.delete(op.rm)) continue;
        const sportId = this.events.get(op.rm)?.sportId;
        this.deref(op.rm);
        if (sportId !== undefined) this.invalidateSort(sportId, topic);
      }
    }
  }

  private upsertEvent(event: SportEvent, complete: boolean): void {
    const existing = this.events.get(event.id);
    const main: number[] = [];
    const all: number[] = [];
    for (const market of event.markets) {
      all.push(market.id);
      if (market.main) main.push(market.id);
      const known = this.markets.get(market.id);
      if (!known || !sameMarket(known, market)) {
        this.markets.set(market.id, {
          id: market.id,
          eventId: event.id,
          type: market.type,
          name: market.name,
          line: market.line,
          status: market.status,
          main: market.main,
          sel: market.sel,
        });
        this.dirty.add(marketKey(market.id));
      }
      const shape = this.shapes.get(market.id);
      if (!shape || shape.name !== market.name || shape.sel.length !== market.sel.length) {
        this.shapes.set(market.id, {
          type: market.type,
          name: market.name,
          line: market.line,
          sel: market.sel.map(({ k, name }) => ({ k, name })),
        });
      }
    }
    const view: EventView = {
      id: event.id,
      sportId: event.sportId,
      league: event.league,
      home: event.home,
      away: event.away,
      start: event.start,
      status: event.status,
      score: event.score,
      main,
      all: complete ? all : existing?.all,
    };
    if (!existing || !sameEvent(existing, view)) {
      this.events.set(event.id, view);
      this.dirty.add(eventKey(event.id));
    }
  }

  private ref(id: number): void {
    this.refs.set(id, (this.refs.get(id) ?? 0) + 1);
  }

  private deref(id: number): void {
    const count = (this.refs.get(id) ?? 0) - 1;
    if (count > 0) {
      this.refs.set(id, count);
      return;
    }
    this.refs.delete(id);
    const event = this.events.get(id);
    if (!event) return;
    for (const marketId of event.all ?? event.main) {
      this.markets.delete(marketId);
      this.shapes.delete(marketId);
    }
    this.events.delete(id);
  }

  private invalidateSort(sportId: number, topic: Topic): void {
    for (const t of [topic, sportTopic(sportId)]) {
      this.sorted.delete(t);
      if (this.topicEvents.has(t)) this.dirty.add(topicKey(t));
    }
  }

  private notify(): void {
    if (this.dirty.size === 0) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) {
      const set = this.listeners.get(key);
      if (set) for (const listener of [...set]) listener();
    }
  }

  private readonly compareIds = (a: number, b: number): number => {
    const ea = this.events.get(a);
    const eb = this.events.get(b);
    return ea && eb ? compareEvents(ea, eb) : 0;
  };
}

const EMPTY: number[] = [];

function sameMarket(a: MarketView, b: SportEvent['markets'][number]): boolean {
  return (
    a.status === b.status &&
    a.name === b.name &&
    a.sel.length === b.sel.length &&
    a.sel.every((s, i) => s.k === b.sel[i]?.k && s.p === b.sel[i]?.p)
  );
}

function sameEvent(a: EventView, b: EventView): boolean {
  return (
    a.status === b.status &&
    a.score?.[0] === b.score?.[0] &&
    a.score?.[1] === b.score?.[1] &&
    a.start === b.start &&
    a.main.length === b.main.length &&
    a.all?.length === b.all?.length
  );
}
