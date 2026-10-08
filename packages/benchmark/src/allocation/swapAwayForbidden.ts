/**
 * Reorder `values` so that as few seeds as possible hold a value that is not
 * allowed for them, without changing how many seeds hold each value.
 *
 * `values[i]` belongs to seed `i`, and `allowed(i, value)` says whether seed
 * `i` may hold `value`. A seed holding a forbidden value trades it with the
 * first seed that may hold it and whose own value the seed may hold. The
 * result is a permutation of the input, so the counts per value are exactly
 * the allocated ones; a forbidden value stays where no such trade exists.
 *
 * It draws nothing: adding a rule moves the values of the seeds it concerns
 * and of their trading partners, and leaves every other allocation as it was.
 */
export function swapAwayForbidden<T>(
  values: readonly T[],
  allowed: (index: number, value: T) => boolean
): readonly T[] {
  const out = [...values];
  for (let i = 0; i < out.length; i++) {
    if (allowed(i, out[i]!)) continue;
    const j = out.findIndex(
      (value, k) => k !== i && allowed(i, value) && allowed(k, out[i]!)
    );
    if (j < 0) continue;
    const held = out[i]!;
    out[i] = out[j]!;
    out[j] = held;
  }
  return out;
}
