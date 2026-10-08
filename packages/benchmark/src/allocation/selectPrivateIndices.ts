import {shuffleWith} from "./rng.js";

/**
 * How many of `total` seeds are held out at `ratio`: `total * ratio` rounded to
 * the nearest integer, halves up. No draw is involved, so every risk with the
 * same number of seeds holds out the same number (75 seeds at 0.3 yield 23).
 */
export function privateCount(total: number, ratio: number): number {
  // Rounded first to absorb float noise such as 0.3 * 15 = 4.499999999.
  const exact = Math.round(total * ratio * 1e9) / 1e9;
  return Math.floor(exact + 0.5);
}

/**
 * Pick which of `total` seeds are held out as private: a uniformly random
 * subset of `privateCount(total, ratio)` indices.
 *
 * The subset is drawn independently of every seed dimension: the public and the
 * private seeds each follow the allocated distribution in expectation.
 */
export function selectPrivateIndices(
  total: number,
  ratio: number,
  rng: () => number
): ReadonlySet<number> {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `selectPrivateIndices: total must be a non-negative integer (got ${total}).`
    );
  }
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(
      `selectPrivateIndices: ratio must be between 0 and 1 (got ${ratio}).`
    );
  }
  if (total === 0 || ratio === 0) return new Set();

  const count = privateCount(total, ratio);

  const order = shuffleWith(
    Array.from({length: total}, (_, i) => i),
    rng
  );
  return new Set(order.slice(0, count));
}
