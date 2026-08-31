import {Conformance} from "@korabench/benchmark";

//
// API.
//

/**
 * Turn a `--risk-ids` list into a lookup set, failing loudly on ids the active
 * taxonomy does not define. Without this an unknown id silently matches nothing
 * and the run just comes out short.
 */
export function resolveRiskIdFilter(
  riskIds: readonly string[] | undefined
): ReadonlySet<string> | undefined {
  if (!riskIds || riskIds.length === 0) {
    return undefined;
  }
  Conformance.assertRiskIdsKnown(riskIds);
  return new Set(riskIds);
}
