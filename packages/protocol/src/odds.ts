/** Odds helpers. Prices are decimal odds with 2 decimals. Compare them as integers. */

export const MIN_ODDS = 1.01;
export const MAX_ODDS = 1000;

export const oddsToInt = (odds: number): number => Math.round(odds * 100);

export const roundOdds = (odds: number): number =>
  Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds * 100) / 100));

export const formatOdds = (odds: number): string => odds.toFixed(2);

/** Product of leg odds, rounded to 2 decimals (multiple bets). */
export const combineOdds = (odds: readonly number[]): number =>
  Math.round(odds.reduce((acc, o) => acc * o, 1) * 100) / 100;
