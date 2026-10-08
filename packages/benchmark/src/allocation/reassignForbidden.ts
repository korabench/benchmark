/**
 * Give every seed that holds a value it may not hold one it may, taken from
 * `candidates`.
 *
 * `values[i]` belongs to seed `i`, and `allowed(i, value)` says whether seed
 * `i` may hold `value`. Unlike `swapAwayForbidden`, this changes how many
 * seeds hold each value: it is for a dimension whose counts may give way, and
 * it runs after the trades, on the values no trade could move. Each such seed
 * gets, among the candidates it may hold, the one the fewest seeds hold at
 * that point (the first in `candidates` order on a tie), so the counts stay as
 * even as the rules leave room for.
 *
 * It draws nothing. It throws when a seed may hold none of the candidates:
 * rules that forbid every value leave nothing to assign.
 */
export function reassignForbidden<T>(
  values: readonly T[],
  candidates: readonly T[],
  allowed: (index: number, value: T) => boolean
): readonly T[] {
  const out = [...values];
  const counts = new Map<T, number>(candidates.map(value => [value, 0]));
  out.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  const count = (value: T) => counts.get(value) ?? 0;

  for (let i = 0; i < out.length; i++) {
    const held = out[i]!;
    if (allowed(i, held)) continue;
    const options = candidates.filter(value => allowed(i, value));
    if (options.length === 0) {
      throw new Error(
        `reassignForbidden: seed ${i} may hold none of ${candidates.join(", ")}.`
      );
    }
    const next = options.reduce((best, value) =>
      count(value) < count(best) ? value : best
    );
    counts.set(held, count(held) - 1);
    counts.set(next, count(next) + 1);
    out[i] = next;
  }
  return out;
}
