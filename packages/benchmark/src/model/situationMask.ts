import * as v from "valibot";
import bundledData from "../../data/situationMask.json" with {type: "json"};
import {RiskSignalType, SeedUse} from "./scenarioSeed.js";

//
// Runtime model.
//
// Values a seed of a given situation type is never given: the uses and the
// risk signal types that contradict what the situation type is. A rule names a
// situation type and, optionally, the risk it belongs to; without a risk it
// applies to every risk with a situation type of that name.
//
// It only shapes which seed of a risk carries which use and which signal type
// (see `allocation/swapAwayForbidden.ts`). Which situation type a seed has is
// never changed, and neither is how many seeds of the risk receive each use
// and each signal type. Like the motivation × use mask, it is seed-generation
// input, not part of the pack.
//
// Keep it small: a pair belongs here when the two definitions contradict each
// other and rejections show it, not when a pairing is merely unusual.
//

function rule<T extends string>(values: readonly [T, ...T[]]) {
  return v.strictObject({
    riskId: v.optional(v.string()),
    situationType: v.string(),
    forbidden: v.pipe(v.array(v.picklist(values)), v.minLength(1)),
    /** Why the pair is forbidden, and the evidence for it. */
    reason: v.string(),
  });
}

const VSituationMask = v.strictObject({
  use: v.array(rule(SeedUse.list)),
  riskSignalType: v.array(rule(RiskSignalType.list)),
});

//
// API.
//

let cached: SituationMask | undefined;

function bundled(): SituationMask {
  return (cached ??= v.parse(VSituationMask, bundledData));
}

function allowed<T extends string>(
  rules: readonly SituationMaskRule<T>[],
  riskId: string,
  situationType: string,
  value: T
): boolean {
  return !rules.some(
    r =>
      r.situationType === situationType &&
      (r.riskId === undefined || r.riskId === riskId) &&
      r.forbidden.includes(value)
  );
}

/** A pair the mask does not list is allowed. */
function allowsUse(
  mask: SituationMask,
  riskId: string,
  situationType: string,
  use: SeedUse
): boolean {
  return allowed(mask.use, riskId, situationType, use);
}

/** A pair the mask does not list is allowed. */
function allowsRiskSignalType(
  mask: SituationMask,
  riskId: string,
  situationType: string,
  riskSignalType: RiskSignalType
): boolean {
  return allowed(mask.riskSignalType, riskId, situationType, riskSignalType);
}

//
// Exports.
//

export interface SituationMaskRule<T extends string> {
  riskId?: string;
  situationType: string;
  forbidden: readonly T[];
  reason: string;
}
export type SituationMask = v.InferOutput<typeof VSituationMask>;

export const SituationMask = {
  io: VSituationMask,
  bundled,
  allowsUse,
  allowsRiskSignalType,
};
