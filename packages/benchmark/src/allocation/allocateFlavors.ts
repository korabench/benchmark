import {ScenarioFlavor} from "../model/scenarioFlavor.js";
import {largestRemainderCounts} from "./largestRemainder.js";
import {shuffleWith} from "./rng.js";

/**
 * Produce exactly `total` pinned scenario-flavor ids whose marginal counts
 * match the proportions on `flavors` (within integer rounding, via
 * largest-remainder), then shuffled with the supplied RNG so that ordering
 * is independent from the persona allocation it will be zipped with.
 *
 * `flavors[].proportion` is assumed to sum to 1.0 — validated at risk-load
 * time by `assertFlavorsSumToOne`.
 */
export function allocateFlavors(
  flavors: readonly ScenarioFlavor[],
  total: number,
  rng: () => number
): readonly string[] {
  if (total === 0) return [];

  const proportions = Object.fromEntries(
    flavors.map(f => [f.id, f.proportion])
  );
  const counts = largestRemainderCounts(proportions, total);
  const flat = flavors.flatMap(f =>
    Array.from({length: counts[f.id] ?? 0}, () => f.id)
  );
  return shuffleWith(flat, rng);
}
