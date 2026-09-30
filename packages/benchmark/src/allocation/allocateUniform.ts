import {shuffleWith} from "./rng.js";

/**
 * Produce exactly `total` values drawn evenly from `values`: every value
 * appears either `floor(total / n)` or that + 1 times, and the result is
 * shuffled with the supplied RNG so the ordering is independent from any
 * allocation it will be zipped with.
 *
 * When `total` is not a multiple of `values.length`, the values that receive
 * the extra seed are themselves drawn at random. Giving the remainder to the
 * first values every time would favour them systematically once the allocation
 * is repeated per risk (e.g. 10 seeds over 3 values would yield 4/3/3 for every
 * risk, i.e. 40/30/30 across the corpus instead of thirds).
 */
export function allocateUniform<T>(
  values: readonly T[],
  total: number,
  rng: () => number
): readonly T[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `allocateUniform: total must be a non-negative integer (got ${total}).`
    );
  }
  if (values.length === 0) {
    throw new Error("allocateUniform: values must be non-empty.");
  }
  if (total === 0) return [];

  const order = shuffleWith(values, rng);
  const base = Math.floor(total / order.length);
  const extra = total % order.length;
  const flat = order.flatMap((value, index) =>
    Array.from({length: base + (index < extra ? 1 : 0)}, () => value)
  );
  return shuffleWith(flat, rng);
}
