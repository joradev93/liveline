/**
 * Domain model shared by every service. All data is synthetic (see apps/feed-sim).
 */

export type EventStatus = 'prematch' | 'live' | 'suspended' | 'settled';
export type MarketStatus = 'open' | 'suspended' | 'settled';

export type MarketType =
  | 'match-result' // 1X2
  | 'match-winner' // 2-way
  | 'total' // over / under a line
  | 'handicap'
  | 'btts' // both teams to score
  | 'double-chance'
  | 'next-goal';

export interface Selection {
  /** Stable key inside the market, e.g. "1", "X", "2", "O", "U". */
  k: string;
  name: string;
  /** Decimal odds with 2 decimals. */
  p: number;
}

export interface Market {
  id: number;
  eventId: number;
  type: MarketType;
  name: string;
  line?: number;
  status: MarketStatus;
  /** Main markets are shown in list views and carried by `sport:{id}` topics. */
  main: boolean;
  sel: Selection[];
}

export interface SportEvent {
  id: number;
  sportId: number;
  league: string;
  home: string;
  away: string;
  /** Start time, epoch ms. */
  start: number;
  status: EventStatus;
  score?: [number, number];
  markets: Market[];
}

export interface Sport {
  id: number;
  name: string;
  /** Whether a draw is possible (decides 1X2 vs 2-way main market). */
  draw: boolean;
}

export const SPORTS: readonly Sport[] = [
  { id: 1, name: 'Football', draw: true },
  { id: 2, name: 'Basketball', draw: false },
  { id: 3, name: 'Tennis', draw: false },
  { id: 4, name: 'Ice Hockey', draw: true },
  { id: 5, name: 'Volleyball', draw: false },
  { id: 6, name: 'Table Tennis', draw: false },
];
