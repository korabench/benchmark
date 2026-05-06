/**
 * Convert marginal proportions into integer counts summing to exactly `total`
 * using the Hamilton / largest-remainder method.
 *
 * Ties on fractional remainder are broken deterministically by key-insertion
 * order (stable).
 *
 * Properties:
 *  - sum(counts) === total
 *  - For every key k, counts[k] is either floor(total * p[k]) or that + 1
 *  - Proportions must sum to 1 ± 1e-6; otherwise throws
 *  - total === 0 yields all zeros
 */
export function largestRemainderCounts<K extends string>(
  proportions: Record<K, number>,
  total: number
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

  // Sort by descending remainder, then ascending insertion index (stable).
  const ranked = [...raw].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  });

  const bonus = new Set(ranked.slice(0, leftover).map(r => r.key));

  return Object.fromEntries(
    raw.map(r => [r.key, r.floor + (bonus.has(r.key) ? 1 : 0)])
  ) as Record<K, number>;
}
