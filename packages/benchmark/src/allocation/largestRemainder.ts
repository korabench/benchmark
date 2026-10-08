interface RawCount<K> {
  key: K;
  index: number;
  floor: number;
  remainder: number;
}

/**
 * Pick which `leftover` keys receive the +1, deterministically: descending
 * remainder, ties by insertion order.
 */
function pickLargest<K>(raw: readonly RawCount<K>[], leftover: number): K[] {
  const ranked = [...raw].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  });
  return ranked.slice(0, leftover).map(r => r.key);
}

/**
 * Pick which `leftover` keys receive the +1 at random, without replacement,
 * each draw weighted by the remaining keys' fractional remainders. A key's
 * chance of the +1 then equals its remainder, so the expected count is exactly
 * `total * p[k]` and no value is favoured when the same proportions are
 * allocated many times over (once per risk, say).
 */
function pickWeighted<K>(
  raw: readonly RawCount<K>[],
  leftover: number,
  rng: () => number
): K[] {
  const draw = (
    candidates: readonly RawCount<K>[],
    remaining: number,
    picked: readonly K[]
  ): K[] => {
    if (remaining === 0) return [...picked];
    const weight = candidates.reduce((acc, r) => acc + r.remainder, 0);
    if (weight <= 0) {
      throw new Error("largestRemainderCounts: no remainder left to allocate.");
    }
    const target = rng() * weight;
    const chosen =
      candidates.reduce<{acc: number; hit?: RawCount<K>}>(
        (state, r) =>
          state.hit !== undefined
            ? state
            : state.acc + r.remainder > target
              ? {acc: state.acc, hit: r}
              : {acc: state.acc + r.remainder},
        {acc: 0}
      ).hit ?? candidates[candidates.length - 1]!;
    return draw(
      candidates.filter(r => r !== chosen),
      remaining - 1,
      [...picked, chosen.key]
    );
  };
  return draw(
    raw.filter(r => r.remainder > 0),
    leftover,
    []
  );
}

/**
 * Convert marginal proportions into integer counts summing to exactly `total`
 * using the Hamilton / largest-remainder method.
 *
 * Without `rng`, ties on fractional remainder are broken deterministically by
 * key-insertion order (stable), and the same proportions always round the same
 * way. With `rng`, the leftover units go to keys drawn at random in proportion
 * to their remainder, so repeated allocations are unbiased in expectation.
 *
 * Properties:
 *  - sum(counts) === total
 *  - For every key k, counts[k] is either floor(total * p[k]) or that + 1
 *  - Proportions must sum to 1 ± 1e-6; otherwise throws
 *  - total === 0 yields all zeros
 */
export function largestRemainderCounts<K extends string>(
  proportions: Record<K, number>,
  total: number,
  rng?: () => number
): Record<K, number> {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `largestRemainderCounts: total must be a non-negative integer (got ${total}).`
    );
  }

  const keys = Object.keys(proportions) as K[];
  if (keys.length === 0) {
    throw new Error("largestRemainderCounts: proportions must be non-empty.");
  }

  const sum = keys.reduce((acc, k) => acc + proportions[k], 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(
      `largestRemainderCounts: proportions sum to ${sum}, expected 1.0.`
    );
  }

  if (total === 0) {
    return Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;
  }

  const raw = keys.map((key, index) => {
    const exact = proportions[key] * total;
    const floor = Math.floor(exact);
    return {key, index, floor, remainder: exact - floor};
  });

  const allocated = raw.reduce((acc, r) => acc + r.floor, 0);
  const leftover = total - allocated;

  const bonus = new Set(
    rng ? pickWeighted(raw, leftover, rng) : pickLargest(raw, leftover)
  );

  return Object.fromEntries(
    raw.map(r => [r.key, r.floor + (bonus.has(r.key) ? 1 : 0)])
  ) as Record<K, number>;
}
