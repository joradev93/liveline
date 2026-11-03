import {
  SPORTS,
  type Market,
  type MarketType,
  type Selection,
  type Sport,
  type SportEvent,
} from '@liveline/protocol';
import { leagueName, teamName } from './names.js';
import { normalize, toOdds } from './pricing.js';
import type { Rng } from './rng.js';

/** Hidden "true" probabilities behind a market. Prices are derived from these. */
export interface MarketModel {
  probs: number[];
  /** Sum of probs: 1 for normal markets, 2 for double chance. */
  total: number;
}

export interface GeneratedEvent {
  event: SportEvent;
  models: Map<number, MarketModel>;
}

export class IdSequence {
  constructor(private value = 0) {}
  next(): number {
    return ++this.value;
  }
}

/** Typical main line for totals per sport. */
const TOTAL_LINE: Record<number, number> = { 1: 2.5, 2: 210.5, 3: 22.5, 4: 5.5, 5: 3.5, 6: 3.5 };
const LINE_STEP: Record<number, number> = { 1: 1, 2: 5, 3: 1, 4: 1, 5: 1, 6: 1 };
const HANDICAP_LINE: Record<number, number> = { 1: 1.5, 2: 6.5, 3: 3.5, 4: 1.5, 5: 1.5, 6: 1.5 };

interface MarketSpec {
  type: MarketType;
  name: string;
  line?: number;
  keys: { k: string; name: string }[];
  probs: number[];
  total?: number;
}

function buildMarket(
  spec: MarketSpec,
  id: number,
  eventId: number,
  main: boolean,
): { market: Market; model: MarketModel } {
  const total = spec.total ?? 1;
  const probs = normalize(spec.probs, total);
  const odds = toOdds(probs);
  const sel: Selection[] = spec.keys.map((key, i) => ({ ...key, p: odds[i] ?? 1.01 }));
  const market: Market = {
    id,
    eventId,
    type: spec.type,
    name: spec.name,
    status: 'open',
    main,
    sel,
  };
  if (spec.line !== undefined) market.line = spec.line;
  return { market, model: { probs, total } };
}

function mainSpecs(
  sport: Sport,
  home: string,
  away: string,
  strength: number,
  rng: Rng,
): MarketSpec[] {
  const pHome = 1 / (1 + Math.exp(-strength));
  const winner: MarketSpec = sport.draw
    ? {
        type: 'match-result',
        name: 'Match Result',
        keys: [
          { k: '1', name: home },
          { k: 'X', name: 'Draw' },
          { k: '2', name: away },
        ],
        probs: [pHome * 0.74, 0.26, (1 - pHome) * 0.74],
      }
    : {
        type: 'match-winner',
        name: 'Winner',
        keys: [
          { k: '1', name: home },
          { k: '2', name: away },
        ],
        probs: [pHome, 1 - pHome],
      };
  const line = TOTAL_LINE[sport.id] ?? 2.5;
  const hcp = HANDICAP_LINE[sport.id] ?? 1.5;
  return [
    winner,
    totalSpec(line, rng.range(0.4, 0.6)),
    handicapSpec(hcp, home, away, Math.min(0.85, Math.max(0.15, pHome - 0.15))),
  ];
}

const totalSpec = (line: number, pOver: number): MarketSpec => ({
  type: 'total',
  name: `Total ${line}`,
  line,
  keys: [
    { k: 'O', name: `Over ${line}` },
    { k: 'U', name: `Under ${line}` },
  ],
  probs: [pOver, 1 - pOver],
});

const handicapSpec = (line: number, home: string, away: string, pHome: number): MarketSpec => ({
  type: 'handicap',
  name: `Handicap -${line}`,
  line: -line,
  keys: [
    { k: 'H', name: `${home} -${line}` },
    { k: 'A', name: `${away} +${line}` },
  ],
  probs: [pHome, 1 - pHome],
});

function extraSpecs(
  sport: Sport,
  home: string,
  away: string,
  count: number,
  rng: Rng,
): MarketSpec[] {
  const specs: MarketSpec[] = [];
  if (sport.draw) {
    specs.push(
      {
        type: 'double-chance',
        name: 'Double Chance',
        keys: [
          { k: '1X', name: `${home} or Draw` },
          { k: '12', name: `${home} or ${away}` },
          { k: 'X2', name: `Draw or ${away}` },
        ],
        probs: [0.7, 0.7, 0.6],
        total: 2,
      },
      {
        type: 'btts',
        name: 'Both Teams To Score',
        keys: [
          { k: 'Y', name: 'Yes' },
          { k: 'N', name: 'No' },
        ],
        probs: [rng.range(0.4, 0.6), 0.5],
      },
      {
        type: 'next-goal',
        name: 'Next Goal',
        keys: [
          { k: '1', name: home },
          { k: 'N', name: 'No goal' },
          { k: '2', name: away },
        ],
        probs: [0.42, 0.16, 0.42],
      },
    );
  }
  // Fill the rest with alternative total and handicap lines.
  const base = TOTAL_LINE[sport.id] ?? 2.5;
  const step = LINE_STEP[sport.id] ?? 1;
  for (let i = 1; specs.length < count; i++) {
    const offset = Math.ceil(i / 2) * step * (i % 2 === 1 ? 1 : -1);
    const line = base + offset;
    if (line > 0)
      specs.push(totalSpec(line, Math.min(0.9, Math.max(0.1, 0.5 - offset / (base * 2 + step)))));
    if (specs.length < count && i <= 6) {
      const hcp = (HANDICAP_LINE[sport.id] ?? 1.5) + Math.ceil(i / 2) * step;
      specs.push(handicapSpec(hcp, home, away, Math.max(0.1, 0.45 - i * 0.05)));
    }
  }
  return specs.slice(0, count);
}

export interface CreateEventOptions {
  now: number;
  /** When true the event starts already live with a random score. */
  live: boolean;
  liveDurationMs: number;
}

export function createEvent(
  rng: Rng,
  eventIds: IdSequence,
  marketIds: IdSequence,
  opts: CreateEventOptions,
): GeneratedEvent {
  const sport = rng.pick(SPORTS);
  const id = eventIds.next();
  const home = teamName(rng, sport.id);
  let away = teamName(rng, sport.id);
  while (away === home) away = teamName(rng, sport.id);

  const strength = rng.normal() * 0.8;
  const marketCount = rng.int(5, 20);
  const specs = [
    ...mainSpecs(sport, home, away, strength, rng),
    ...extraSpecs(sport, home, away, marketCount - 3, rng),
  ];

  const models = new Map<number, MarketModel>();
  const markets = specs.map((spec, i) => {
    const { market, model } = buildMarket(spec, marketIds.next(), id, i < 3);
    models.set(market.id, model);
    return market;
  });

  const event: SportEvent = {
    id,
    sportId: sport.id,
    league: leagueName(rng),
    home,
    away,
    start: opts.live
      ? opts.now - Math.floor(rng.next() * opts.liveDurationMs * 0.8)
      : opts.now + rng.int(20_000, 20 * 60_000),
    status: opts.live ? 'live' : 'prematch',
    markets,
  };
  if (opts.live) event.score = [rng.int(0, 2), rng.int(0, 2)];
  return { event, models };
}
