import { roundOdds } from '@liveline/protocol';
import type { Rng } from './rng.js';

/** Bookmaker margin applied on top of fair probabilities. */
export const MARGIN = 0.06;

/** Fair probabilities -> decimal odds with margin. */
export function toOdds(probabilities: readonly number[]): number[] {
  return probabilities.map((p) => roundOdds(1 / (p * (1 + MARGIN))));
}

/** Rescale so the probabilities sum to `total` (1 for most markets, 2 for double chance). */
export function normalize(probabilities: readonly number[], total = 1): number[] {
  const sum = probabilities.reduce((a, b) => a + b, 0);
  return probabilities.map((p) => (p / sum) * total);
}

/**
 * One random-walk step in log space. Keeps every probability inside [0.01, 0.98]
 * so prices stay inside a sensible range.
 */
export function walk(
  probabilities: readonly number[],
  rng: Rng,
  sigma: number,
  total = 1,
): number[] {
  const moved = probabilities.map((p) => Math.exp(Math.log(p) + rng.normal() * sigma));
  return normalize(moved, total).map((p) => Math.min(0.98, Math.max(0.01, p)));
}
