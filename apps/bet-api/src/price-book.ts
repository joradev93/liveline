import type { EventStatus, FeedChange, MarketStatus, SportEvent } from '@liveline/protocol';

export interface BookMarket {
  id: number;
  eventId: number;
  status: MarketStatus;
  prices: Map<string, number>;
  /** Increases on every change of this market (price or status). */
  version: number;
}

/** Current prices for bet validation, built from the feed bus. */
export class PriceBook {
  private readonly markets = new Map<number, BookMarket>();
  private readonly events = new Map<number, { status: EventStatus; markets: number[] }>();

  reset(events: readonly SportEvent[]): void {
    this.markets.clear();
    this.events.clear();
    for (const event of events) this.addEvent(event);
  }

  apply(change: FeedChange): void {
    switch (change.k) {
      case 'price': {
        const market = this.markets.get(change.m);
        if (!market) return;
        for (const [k, p] of Object.entries(change.sel)) market.prices.set(k, p);
        market.version++;
        return;
      }
      case 'mst': {
        const market = this.markets.get(change.m);
        if (!market) return;
        market.status = change.st;
        market.version++;
        return;
      }
      case 'est': {
        const event = this.events.get(change.e);
        if (event) event.status = change.st;
        return;
      }
      case 'add':
        this.addEvent(change.event);
        return;
      case 'rm': {
        const event = this.events.get(change.e);
        for (const id of event?.markets ?? []) this.markets.delete(id);
        this.events.delete(change.e);
        return;
      }
    }
  }

  market(id: number): BookMarket | undefined {
    return this.markets.get(id);
  }

  eventStatus(id: number): EventStatus | undefined {
    return this.events.get(id)?.status;
  }

  private addEvent(event: SportEvent): void {
    this.events.set(event.id, { status: event.status, markets: event.markets.map((m) => m.id) });
    for (const m of event.markets) {
      this.markets.set(m.id, {
        id: m.id,
        eventId: event.id,
        status: m.status,
        prices: new Map(m.sel.map((s) => [s.k, s.p])),
        version: 0,
      });
    }
  }
}
