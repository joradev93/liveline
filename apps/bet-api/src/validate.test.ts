import type { AcceptChanges, PlaceBetRequest } from '@liveline/protocol';
import { describe, expect, it } from 'vitest';
import { bookFixture } from './fixtures.js';
import { validateBet } from './validate.js';

const single = (
  odds: number,
  acceptChanges: AcceptChanges = 'none',
  sel = '1',
): PlaceBetRequest => ({
  type: 'single',
  stakeCents: 1000,
  acceptChanges,
  legs: [{ eventId: 1, marketId: 11, sel, odds }],
});

describe('validateBet', () => {
  it('accepts unchanged odds with the market version', () => {
    const result = validateBet(single(2.1), bookFixture());
    expect(result).toEqual({
      ok: true,
      totalOdds: 2.1,
      legs: [{ eventId: 1, marketId: 11, sel: '1', odds: 2.1, marketVersion: 0 }],
    });
  });

  it('compares odds as integers (no float noise)', () => {
    expect(validateBet(single(2.1000000001), bookFixture()).ok).toBe(true);
  });

  describe('when the price moved', () => {
    const moved = (price: number) => {
      const book = bookFixture();
      book.apply({ k: 'price', e: 1, m: 11, sel: { '1': price }, ts: 0 });
      return book;
    };

    it('none: rejects any change and reports the current price', () => {
      expect(validateBet(single(2.1, 'none'), moved(2.2))).toEqual({
        ok: false,
        code: 'ODDS_CHANGED',
        message: 'Odds have changed',
        changes: [{ marketId: 11, sel: '1', requested: 2.1, current: 2.2 }],
      });
    });

    it('higher: accepts a longer price at the current odds', () => {
      const result = validateBet(single(2.1, 'higher'), moved(2.25));
      expect(result).toMatchObject({
        ok: true,
        totalOdds: 2.25,
        legs: [{ odds: 2.25, marketVersion: 1 }],
      });
    });

    it('higher: rejects a shorter price', () => {
      expect(validateBet(single(2.1, 'higher'), moved(2.0))).toMatchObject({
        ok: false,
        code: 'ODDS_CHANGED',
      });
    });

    it('any: accepts a shorter price at the current odds', () => {
      expect(validateBet(single(2.1, 'any'), moved(1.9))).toMatchObject({
        ok: true,
        totalOdds: 1.9,
      });
    });
  });

  it('higher: a multiple is refused if any leg got shorter, even if another got longer', () => {
    const book = bookFixture();
    book.apply({ k: 'price', e: 1, m: 11, sel: { '1': 2.5 }, ts: 0 });
    book.apply({ k: 'price', e: 2, m: 21, sel: { '1': 1.7 }, ts: 0 });
    const req: PlaceBetRequest = {
      type: 'multiple',
      stakeCents: 500,
      acceptChanges: 'higher',
      legs: [
        { eventId: 1, marketId: 11, sel: '1', odds: 2.1 },
        { eventId: 2, marketId: 21, sel: '1', odds: 1.8 },
      ],
    };
    const result = validateBet(req, book);
    expect(result).toMatchObject({ ok: false, code: 'ODDS_CHANGED' });
    if (!result.ok) expect(result.changes).toHaveLength(2);
    expect(validateBet({ ...req, acceptChanges: 'any' }, book)).toMatchObject({
      ok: true,
      totalOdds: 4.25,
    });
  });

  it('rejects two legs from the same event in a multiple', () => {
    const req: PlaceBetRequest = {
      type: 'multiple',
      stakeCents: 500,
      acceptChanges: 'none',
      legs: [
        { eventId: 1, marketId: 11, sel: '1', odds: 2.1 },
        { eventId: 1, marketId: 11, sel: '2', odds: 3.6 },
      ],
    };
    expect(validateBet(req, bookFixture())).toMatchObject({ ok: false, code: 'SAME_EVENT_LEGS' });
  });

  it('rejects unknown markets, wrong event ids and unknown selections', () => {
    const book = bookFixture();
    expect(
      validateBet({ ...single(2), legs: [{ eventId: 1, marketId: 99, sel: '1', odds: 2 }] }, book),
    ).toMatchObject({
      code: 'MARKET_NOT_FOUND',
    });
    expect(
      validateBet({ ...single(2), legs: [{ eventId: 2, marketId: 11, sel: '1', odds: 2 }] }, book),
    ).toMatchObject({
      code: 'MARKET_NOT_FOUND',
    });
    expect(validateBet(single(2, 'any', 'Z'), book)).toMatchObject({ code: 'SELECTION_NOT_FOUND' });
  });

  it('rejects suspended markets, suspended events and closed events', () => {
    const marketSuspended = bookFixture();
    marketSuspended.apply({ k: 'mst', e: 1, m: 11, st: 'suspended', ts: 0 });
    expect(validateBet(single(2.1), marketSuspended)).toMatchObject({ code: 'MARKET_SUSPENDED' });

    const eventSuspended = bookFixture();
    eventSuspended.apply({ k: 'est', e: 1, st: 'suspended', ts: 0 });
    expect(validateBet(single(2.1), eventSuspended)).toMatchObject({ code: 'MARKET_SUSPENDED' });

    const settled = bookFixture();
    settled.apply({ k: 'est', e: 1, st: 'settled', ts: 0 });
    expect(validateBet(single(2.1), settled)).toMatchObject({ code: 'EVENT_CLOSED' });

    const removed = bookFixture();
    removed.apply({ k: 'rm', e: 1, ts: 0 });
    expect(validateBet(single(2.1), removed)).toMatchObject({ code: 'MARKET_NOT_FOUND' });
  });
});
