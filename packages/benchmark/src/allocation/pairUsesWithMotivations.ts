import {MotivationUseLikelihood} from "../model/motivationUseLikelihood.js";
import {SeedUse} from "../model/scenarioSeed.js";

/** Swap attempts per seed: enough for the pairing to forget its start. */
const SWEEPS = 200;

/**
 * Weight of an incompatible (score 0) pairing. Not zero, so the walk can always
 * step out of an incompatible starting point, but small enough that it leaves
 * every such pairing it can.
 */
const INCOMPATIBLE_WEIGHT = 1e-9;

/**
 * Reorder `uses` so that each seed's use suits its motivation, without changing
 * how many seeds receive each use or each motivation.
 *
 * `motivationNames[i]` and `uses[i]` belong to seed `i`. Only the order of
 * `uses` changes: the result is a permutation of the input, so both marginals
 * are exactly the ones allocated. Among all such permutations, one is drawn
 * with probability proportional to the product of its pairings' likelihood
 * scores: typical pairings become more frequent, unlikely ones rarer, and
 * incompatible ones (score 0) disappear whenever the allocated counts leave a
 * way to avoid them. When they do not (a handful of seeds, a single motivation),
 * the counts win and the fewest possible incompatible pairings remain.
 *
 * The draw is a Metropolis walk over swaps of two seeds' uses, followed by a
 * deterministic pass that swaps away any incompatible pairing still standing.
 */
export function pairUsesWithMotivations(
  motivationNames: readonly string[],
  uses: readonly SeedUse[],
  likelihood: MotivationUseLikelihood,
  rng: () => number
): readonly SeedUse[] {
  if (motivationNames.length !== uses.length) {
    throw new Error(
      `pairUsesWithMotivations: got ${motivationNames.length} motivations for ${uses.length} uses.`
    );
  }

  const n = uses.length;
  if (n < 2) return uses;

  const score = (i: number, use: SeedUse) =>
    MotivationUseLikelihood.score(likelihood, motivationNames[i]!, use);
  const weight = (i: number, use: SeedUse) =>
    score(i, use) || INCOMPATIBLE_WEIGHT;

  const out = [...uses];
  const swap = (i: number, j: number) => {
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  };

  for (let step = 0; step < SWEEPS * n; step++) {
    const i = Math.floor(rng() * n);
    const j = Math.floor(rng() * n);
    const accept = rng();
    if (i === j) continue;
    const ratio =
      (weight(i, out[j]!) * weight(j, out[i]!)) /
      (weight(i, out[i]!) * weight(j, out[j]!));
    if (accept < ratio) swap(i, j);
  }

  // The walk leaves an avoidable incompatible pairing only with negligible
  // probability; this makes it certain for any pairing one swap can fix.
  for (let i = 0; i < n; i++) {
    if (score(i, out[i]!) > 0) continue;
    const j = out.findIndex(
      (use, k) => score(i, use) > 0 && score(k, out[i]!) > 0
    );
    if (j >= 0) swap(i, j);
  }

  return out;
}
