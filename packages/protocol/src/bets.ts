/** Bet API contract (apps/bet-api). Money is in integer cents. */

export type AcceptChanges = 'none' | 'higher' | 'any';
export type BetType = 'single' | 'multiple';

export interface BetLegRequest {
  eventId: number;
  marketId: number;
  sel: string;
  /** Odds the user saw when placing the bet. */
  odds: number;
}

export interface PlaceBetRequest {
  type: BetType;
  stakeCents: number;
  acceptChanges: AcceptChanges;
  legs: BetLegRequest[];
}

export interface AcceptedLeg extends BetLegRequest {
  /** Market version at acceptance time. */
  marketVersion: number;
}

export interface Bet {
  id: string;
  type: BetType;
  stakeCents: number;
  totalOdds: number;
  potentialReturnCents: number;
  legs: AcceptedLeg[];
  placedAt: string;
}

export interface BetAccepted {
  status: 'accepted';
  bet: Bet;
  balanceCents: number;
}

export type BetRejectCode =
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'MARKET_NOT_FOUND'
  | 'SELECTION_NOT_FOUND'
  | 'MARKET_SUSPENDED'
  | 'EVENT_CLOSED'
  | 'SAME_EVENT_LEGS'
  | 'ODDS_CHANGED'
  | 'INSUFFICIENT_BALANCE'
  | 'FEED_UNAVAILABLE';

export interface ChangedLeg {
  marketId: number;
  sel: string;
  requested: number;
  current: number;
}

export interface BetRejected {
  status: 'rejected';
  code: BetRejectCode;
  message: string;
  /** Present for ODDS_CHANGED: the current prices the client can accept. */
  changes?: ChangedLeg[];
}

export type PlaceBetResponse = BetAccepted | BetRejected;

export const MAX_STAKE_CENTS = 1_000_000;
export const MAX_LEGS = 12;
