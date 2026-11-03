import type { FeedChange, Market, SportEvent } from '@liveline/protocol';
import { createEvent, IdSequence, type MarketModel } from './generator.js';
import { toOdds, walk } from './pricing.js';
import { Rng } from './rng.js';

export interface SimulatorOptions {
  seed: number;
  eventCount: number;
  /** Share of events that start live. */
  liveShare?: number;
  /** Length of a live event in sim time (matches are compressed). */
  liveDurationMs?: number;
}

/** Per-event timers the lifecycle needs. */
interface EventClock {
  endAt: number;
  resumeAt?: number;
  removeAt?: number;
}

const LIVE_PICK_SHARE = 0.85;
const MARKET_SUSPEND_CHANCE = 0.01;
/** Chance per lifecycle step (100 ms) that a live event scores. */
const SCORE_CHANCE: Record<number, number> = {
  1: 0.0012,
  2: 0.03,
  3: 0.006,
  4: 0.0015,
  5: 0.004,
  6: 0.01,
};
const GOAL_SUSPENDS = new Set([1, 4]);

/**
 * The feed: synthetic events and markets with random-walk prices and a lifecycle
 * prematch -> live -> (suspended -> live)* -> settled -> removed (and replaced).
 *
 * No I/O and no real clock: callers pass `now`, so a seed gives a repeatable feed.
 */
export class FeedSimulator {
  private readonly rng: Rng;
  private readonly eventIds = new IdSequence();
  private readonly marketIds = new IdSequence();
  private readonly events = new Map<number, SportEvent>();
  private readonly markets = new Map<number, Market>();
  private readonly models = new Map<number, MarketModel>();
  private readonly clocks = new Map<number, EventClock>();
  private readonly marketResumeAt = new Map<number, number>();
  private readonly liveDurationMs: number;
  private livePool: number[] = [];
  private prematchPool: number[] = [];
  private poolsDirty = true;

  constructor(opts: SimulatorOptions, now: number) {
    this.rng = new Rng(opts.seed);
    this.liveDurationMs = opts.liveDurationMs ?? 8 * 60_000;
    const liveShare = opts.liveShare ?? 0.4;
    for (let i = 0; i < opts.eventCount; i++) {
      this.addEvent(now, this.rng.chance(liveShare));
    }
  }

  /** Current state of every event (shared references: serialize, do not mutate). */
  snapshot(): SportEvent[] {
    return [...this.events.values()];
  }

  get eventCount(): number {
    return this.events.size;
  }

  get marketCount(): number {
    return this.markets.size;
  }

  countByStatus(): Record<SportEvent['status'], number> {
    const counts = { prematch: 0, live: 0, suspended: 0, settled: 0 };
    for (const event of this.events.values()) counts[event.status]++;
    return counts;
  }

  /** One random change on an open market: a price move, or sometimes a suspension. */
  tick(now: number): FeedChange | null {
    this.rebuildPools();
    for (let attempt = 0; attempt < 5; attempt++) {
      const pool =
        this.livePool.length > 0 &&
        (this.prematchPool.length === 0 || this.rng.chance(LIVE_PICK_SHARE))
          ? this.livePool
          : this.prematchPool;
      if (pool.length === 0) return null;
      const market = this.markets.get(this.rng.pick(pool));
      const event = market && this.events.get(market.eventId);
      if (!market || !event || market.status !== 'open') continue;
      if (event.status !== 'live' && event.status !== 'prematch') continue;

      if (event.status === 'live' && this.rng.chance(MARKET_SUSPEND_CHANCE)) {
        market.status = 'suspended';
        this.marketResumeAt.set(market.id, now + this.rng.int(2_000, 6_000));
        return { k: 'mst', e: event.id, m: market.id, st: 'suspended', ts: now };
      }
      const sel = this.movePrices(market, event.status === 'live' ? 0.05 : 0.02);
      if (sel) return { k: 'price', e: event.id, m: market.id, sel, ts: now };
    }
    return null;
  }

  /** Lifecycle step. Call it about every 100 ms. */
  advance(now: number): FeedChange[] {
    const changes: FeedChange[] = [];

    for (const [marketId, resumeAt] of this.marketResumeAt) {
      if (now < resumeAt) continue;
      this.marketResumeAt.delete(marketId);
      const market = this.markets.get(marketId);
      if (market?.status === 'suspended') {
        market.status = 'open';
        changes.push({ k: 'mst', e: market.eventId, m: market.id, st: 'open', ts: now });
      }
    }

    for (const event of [...this.events.values()]) {
      const clock = this.clocks.get(event.id);
      if (!clock) continue;
      switch (event.status) {
        case 'prematch':
          if (now >= event.start) {
            event.status = 'live';
            event.score = [0, 0];
            clock.endAt = now + this.liveDurationMs;
            this.poolsDirty = true;
            changes.push({ k: 'est', e: event.id, st: 'live', sc: [0, 0], ts: now });
          }
          break;
        case 'live':
          if (now >= clock.endAt) {
            event.status = 'settled';
            clock.removeAt = now + 5_000;
            this.poolsDirty = true;
            changes.push({ k: 'est', e: event.id, st: 'settled', ts: now });
          } else if (this.rng.chance(SCORE_CHANCE[event.sportId] ?? 0.002)) {
            changes.push(this.score(event, clock, now));
          }
          break;
        case 'suspended':
          if (clock.resumeAt !== undefined && now >= clock.resumeAt) {
            event.status = 'live';
            clock.resumeAt = undefined;
            this.poolsDirty = true;
            changes.push({ k: 'est', e: event.id, st: 'live', ts: now });
          }
          break;
        case 'settled':
          if (clock.removeAt !== undefined && now >= clock.removeAt) {
            this.removeEvent(event);
            changes.push({ k: 'rm', e: event.id, ts: now });
            const added = this.addEvent(now, false);
            changes.push({ k: 'add', event: added, ts: now });
          }
          break;
      }
    }
    return changes;
  }

  private score(event: SportEvent, clock: EventClock, now: number): FeedChange {
    const side = this.rng.chance(0.5) ? 0 : 1;
    const points = event.sportId === 2 ? this.rng.int(1, 3) : 1;
    const score: [number, number] = [...(event.score ?? [0, 0])];
    score[side] += points;
    event.score = score;
    if (GOAL_SUSPENDS.has(event.sportId)) {
      event.status = 'suspended';
      clock.resumeAt = now + 3_000;
      this.poolsDirty = true;
      return { k: 'est', e: event.id, st: 'suspended', sc: score, ts: now };
    }
    return { k: 'est', e: event.id, st: 'live', sc: score, ts: now };
  }

  /** Random-walk the market; return the selections whose rounded price changed. */
  private movePrices(market: Market, sigma: number): Record<string, number> | null {
    const model = this.models.get(market.id);
    if (!model) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      model.probs = walk(model.probs, this.rng, sigma, model.total);
      const odds = toOdds(model.probs);
      let changed: Record<string, number> | null = null;
      market.sel.forEach((s, i) => {
        const price = odds[i] ?? s.p;
        if (price !== s.p) {
          s.p = price;
          (changed ??= {})[s.k] = price;
        }
      });
      if (changed) return changed;
    }
    return null;
  }

  private addEvent(now: number, live: boolean): SportEvent {
    const { event, models } = createEvent(this.rng, this.eventIds, this.marketIds, {
      now,
      live,
      liveDurationMs: this.liveDurationMs,
    });
    this.events.set(event.id, event);
    for (const market of event.markets) this.markets.set(market.id, market);
    for (const [id, model] of models) this.models.set(id, model);
    this.clocks.set(event.id, { endAt: live ? event.start + this.liveDurationMs : Infinity });
    this.poolsDirty = true;
    return event;
  }

  private removeEvent(event: SportEvent): void {
    for (const market of event.markets) {
      this.markets.delete(market.id);
      this.models.delete(market.id);
      this.marketResumeAt.delete(market.id);
    }
    this.events.delete(event.id);
    this.clocks.delete(event.id);
    this.poolsDirty = true;
  }

  private rebuildPools(): void {
    if (!this.poolsDirty) return;
    this.livePool = [];
    this.prematchPool = [];
    for (const event of this.events.values()) {
      const pool =
        event.status === 'live'
          ? this.livePool
          : event.status === 'prematch'
            ? this.prematchPool
            : null;
      if (pool) for (const market of event.markets) pool.push(market.id);
    }
    this.poolsDirty = false;
  }
}
