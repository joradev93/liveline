import type { SportEvent } from '@liveline/protocol';
import { PriceBook } from './price-book.js';

/** Two live events; market 11: 1/X/2, market 21: 1/2. */
export function bookFixture(): PriceBook {
  const event = (id: number, marketId: number, sel: [string, number][]): SportEvent => ({
    id,
    sportId: 1,
    league: 'L',
    home: 'H',
    away: 'A',
    start: 0,
    status: 'live',
    markets: [
      {
        id: marketId,
        eventId: id,
        type: 'match-result',
        name: 'Match Result',
        status: 'open',
        main: true,
        sel: sel.map(([k, p]) => ({ k, name: k, p })),
      },
    ],
  });
  const book = new PriceBook();
  book.reset([
    event(1, 11, [
      ['1', 2.1],
      ['X', 3.4],
      ['2', 3.6],
    ]),
    event(2, 21, [
      ['1', 1.8],
      ['2', 2.0],
    ]),
  ]);
  return book;
}
