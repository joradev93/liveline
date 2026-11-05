import {
  SPORTS,
  eventTopic,
  sportTopic,
  type DeltaOp,
  type FeedChange,
  type Market,
  type ParsedTopic,
  type SportEvent,
  type Topic,
} from '@liveline/protocol';

/** Receives the topic-level ops produced by one feed change. */
export type OpSink = (topic: Topic, op: DeltaOp, ts: number) => void;

const KNOWN_SPORTS = new Set(SPORTS.map((s) => s.id));

/**
 * Current state of every event and market, built from the feed bus.
 * Translates feed changes into ops for the `sport:{id}` and `event:{id}` topics.
 */
export class MarketState {
  private readonly events = new Map<number, SportEvent>();
  private readonly markets = new Map<number, Market>();
  private readonly bySport = new Map<number, Set<number>>();

  get eventCount(): number {
    return this.events.size;
  }

  reset(events: SportEvent[]): void {
    this.events.clear();
    this.markets.clear();
    this.bySport.clear();
    for (const event of events) this.insert(event);
  }

  apply(change: FeedChange, emit: OpSink): void {
    switch (change.k) {
      case 'price':
      case 'mst': {
        const market = this.markets.get(change.m);
        const event = market && this.events.get(market.eventId);
        if (!market || !event) return;
        let op: DeltaOp;
        if (change.k === 'price') {
          for (const sel of market.sel) {
            const price = change.sel[sel.k];
            if (price !== undefined) sel.p = price;
          }
          op = { m: market.id, sel: change.sel };
        } else {
          market.status = change.st;
          op = { m: market.id, st: change.st };
        }
        emit(eventTopic(event.id), op, change.ts);
        if (market.main) emit(sportTopic(event.sportId), op, change.ts);
        return;
      }
      case 'est': {
        const event = this.events.get(change.e);
        if (!event) return;
        event.status = change.st;
        const op: DeltaOp = { e: event.id, est: change.st };
        if (change.sc) {
          event.score = change.sc;
          op.sc = change.sc;
        }
        emit(eventTopic(event.id), op, change.ts);
        emit(sportTopic(event.sportId), op, change.ts);
        return;
      }
      case 'add':
        this.insert(change.event);
        emit(sportTopic(change.event.sportId), { add: this.mainView(change.event) }, change.ts);
        return;
      case 'rm': {
        const event = this.events.get(change.e);
        if (!event) return;
        this.remove(event);
        emit(eventTopic(event.id), { rm: event.id }, change.ts);
        emit(sportTopic(event.sportId), { rm: event.id }, change.ts);
        return;
      }
    }
  }

  /** Whether a topic can be subscribed to right now. */
  exists(topic: ParsedTopic): boolean {
    return topic.kind === 'sport' ? KNOWN_SPORTS.has(topic.id) : this.events.has(topic.id);
  }

  /** Number of events per known sport (0 for a sport without events), keyed by sport id. */
  sportCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const id of KNOWN_SPORTS) counts[id] = this.bySport.get(id)?.size ?? 0;
    return counts;
  }

  /** Snapshot payload for a topic: sport topics carry main markets only. */
  snapshot(topic: ParsedTopic): SportEvent[] {
    if (topic.kind === 'event') {
      const event = this.events.get(topic.id);
      return event ? [event] : [];
    }
    const ids = this.bySport.get(topic.id);
    if (!ids) return [];
    const out: SportEvent[] = [];
    for (const id of ids) {
      const event = this.events.get(id);
      if (event) out.push(this.mainView(event));
    }
    return out;
  }

  private mainView(event: SportEvent): SportEvent {
    return { ...event, markets: event.markets.filter((m) => m.main) };
  }

  private insert(event: SportEvent): void {
    this.events.set(event.id, event);
    for (const market of event.markets) this.markets.set(market.id, market);
    let ids = this.bySport.get(event.sportId);
    if (!ids) this.bySport.set(event.sportId, (ids = new Set()));
    ids.add(event.id);
  }

  private remove(event: SportEvent): void {
    for (const market of event.markets) this.markets.delete(market.id);
    this.events.delete(event.id);
    this.bySport.get(event.sportId)?.delete(event.id);
  }
}
