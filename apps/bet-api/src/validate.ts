import {
  combineOdds,
  oddsToInt,
  type AcceptedLeg,
  type BetRejectCode,
  type ChangedLeg,
  type PlaceBetRequest,
} from '@liveline/protocol';
import type { PriceBook } from './price-book.js';

export type Validation =
  | { ok: true; legs: AcceptedLeg[]; totalOdds: number }
  | { ok: false; code: BetRejectCode; message: string; changes?: ChangedLeg[] };

const reject = (code: BetRejectCode, message: string, changes?: ChangedLeg[]): Validation => ({
  ok: false,
  code,
  message,
  ...(changes ? { changes } : {}),
});

/**
 * Checks a bet against the current market state. Pure: no I/O, no clock.
 *
 * Odds policy (`acceptChanges`):
 * - `none`:   every leg must still have exactly the requested price
 * - `higher`: accept if no leg got shorter; legs are placed at the current (higher or equal) price
 * - `any`:    accept at the current prices
 * Prices are compared as integers (odds × 100).
 */
export function validateBet(req: PlaceBetRequest, book: PriceBook): Validation {
  if (req.type === 'multiple') {
    const events = new Set(req.legs.map((l) => l.eventId));
    if (events.size !== req.legs.length) {
      return reject('SAME_EVENT_LEGS', 'A multiple cannot have two selections from the same event');
    }
  }

  const accepted: AcceptedLeg[] = [];
  const changes: ChangedLeg[] = [];
  let shortened = false;

  for (const leg of req.legs) {
    const market = book.market(leg.marketId);
    if (!market || market.eventId !== leg.eventId) {
      return reject('MARKET_NOT_FOUND', `Market ${leg.marketId} is not available`);
    }
    const eventStatus = book.eventStatus(leg.eventId);
    if (eventStatus === undefined || eventStatus === 'settled' || market.status === 'settled') {
      return reject('EVENT_CLOSED', `Event ${leg.eventId} is closed for betting`);
    }
    if (eventStatus === 'suspended' || market.status === 'suspended') {
      return reject('MARKET_SUSPENDED', `Market ${leg.marketId} is suspended`);
    }
    const current = market.prices.get(leg.sel);
    if (current === undefined) {
      return reject('SELECTION_NOT_FOUND', `Selection ${leg.sel} is not in market ${leg.marketId}`);
    }
    if (oddsToInt(current) !== oddsToInt(leg.odds)) {
      changes.push({ marketId: leg.marketId, sel: leg.sel, requested: leg.odds, current });
      if (oddsToInt(current) < oddsToInt(leg.odds)) shortened = true;
    }
    accepted.push({ ...leg, odds: current, marketVersion: market.version });
  }

  if (changes.length > 0) {
    const refused = req.acceptChanges === 'none' || (req.acceptChanges === 'higher' && shortened);
    if (refused) return reject('ODDS_CHANGED', 'Odds have changed', changes);
  }

  return { ok: true, legs: accepted, totalOdds: combineOdds(accepted.map((l) => l.odds)) };
}
