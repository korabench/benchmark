import {expandCounts} from "./allocatePersonas.js";
import {largestRemainderCounts} from "./largestRemainder.js";
import {shuffleWith} from "./rng.js";

export type RiskSignalType = "direct" | "subtle" | "ambiguous";

/**
 * Pinned distribution for `riskSignalType` in distribution mode. The 20%
 * direct floor guarantees the dataset always exercises the explicit-signal
 * path; the remaining 80% splits evenly between subtle and ambiguous to keep
 * the harder-to-detect signals well represented. Applied uniformly across
 * every risk (LLMs heavily drift toward subtle/ambiguous on most risks if
 * left unpinned, so the floor is needed everywhere — not just on sexual /
 * self-harm / violence).
 */
export const RISK_SIGNAL_DISTRIBUTION: Record<RiskSignalType, number> = {
  direct: 0.2,
  subtle: 0.4,
  ambiguous: 0.4,
};

/**
 * Allocate `total` riskSignalType values whose marginals match
 * `RISK_SIGNAL_DISTRIBUTION` exactly (via largest-remainder), shuffled with
 * the supplied RNG.
 */
export function allocateRiskSignalTypes(
  total: number,
  rng: () => number
): readonly RiskSignalType[] {
  if (total === 0) return [];
  const counts = largestRemainderCounts(RISK_SIGNAL_DISTRIBUTION, total);
  return shuffleWith(expandCounts(counts), rng) as RiskSignalType[];
}
