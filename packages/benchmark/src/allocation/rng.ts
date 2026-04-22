/**
 * Seeded pseudo-random number generator (mulberry32).
 * Returns a function that yields numbers in [0, 1). Identical seeds produce
 * identical sequences.
 *
 * When `seed` is undefined, falls back to Math.random (non-deterministic).
 */
export function makeRng(seed: number | undefined): () => number {
  if (seed === undefined) {
    return Math.random;
  }

  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using the supplied RNG. Non-mutating: returns a new array.
 */
export function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
