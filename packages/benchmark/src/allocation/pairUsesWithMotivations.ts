import {MotivationUseMask} from "../model/motivationUseMask.js";
import {SeedUse} from "../model/scenarioSeed.js";

/** Swap attempts per seed: enough for the pairing to forget its start. */
const SWEEPS = 200;

/**
 * Weight of a forbidden pairing. Not zero, so the walk can always step out of
 * a forbidden starting point, but small enough that it leaves every such
 * pairing it can.
 */
const FORBIDDEN_WEIGHT = 1e-9;

/**
 * Reorder `uses` so that no seed's use is forbidden for its motivation, without
 * changing how many seeds receive each use or each motivation.
 *
 * `motivationNames[i]` and `uses[i]` belong to seed `i`. Only the order of
 * `uses` changes: the result is a permutation of the input, so both marginals
 * are exactly the ones allocated. The permutation is drawn uniformly among
 * those the mask allows: every allowed pairing is as likely as the counts
 * permit, and forbidden ones disappear whenever the allocated counts leave a
 * way to avoid them. When they do not (a handful of seeds, a single
 * motivation), the counts win and the fewest possible forbidden pairings
 * remain.
 *
 * The draw is a Metropolis walk over swaps of two seeds' uses, followed by a
 * deterministic pass that swaps away any forbidden pairing still standing.
 */
export function pairUsesWithMotivations(
  motivationNames: readonly string[],
  uses: readonly SeedUse[],
  mask: MotivationUseMask,
  rng: () => number
): readonly SeedUse[] {
  if (motivationNames.length !== uses.length) {
    throw new Error(
      `pairUsesWithMotivations: got ${motivationNames.length} motivations for ${uses.length} uses.`
    );
  }

  const n = uses.length;
  if (n < 2) return uses;

  const allowed = (i: number, use: SeedUse) =>
    MotivationUseMask.allowed(mask, motivationNames[i]!, use);
  const weight = (i: number, use: SeedUse) =>
    allowed(i, use) ? 1 : FORBIDDEN_WEIGHT;

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

  // The walk leaves an avoidable forbidden pairing only with negligible
  // probability; this makes it certain for any pairing one swap can fix.
  for (let i = 0; i < n; i++) {
    if (allowed(i, out[i]!)) continue;
    const j = out.findIndex((use, k) => allowed(i, use) && allowed(k, out[i]!));
    if (j >= 0) swap(i, j);
  }

  return out;
}
