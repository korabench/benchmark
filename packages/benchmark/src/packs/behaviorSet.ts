import {Hash} from "@korabench/core";
import * as v from "valibot";
import {PackId} from "./packId.js";
import {stableJson} from "./stableJson.js";

//
// Runtime model.
//
// NOTE ON NAMING. This is the same concept the rest of the codebase calls a
// "mechanism" (M1-M7). New pack code uses "behavior"; the existing `Mechanism`
// type, the persisted `mechanismAssessment` / `sums.mechanisms` fields and the
// `--mechanism-ids` flag deliberately keep the old name for now.
// `model/mechanism.ts` is the bridge between the two.
//
// When the rename is picked up, beware: v1 persisted `TestResult.behaviorAssessment`
// with three behaviors (an/eh/hr) and v2 renamed it to `mechanismAssessment`
// with the seven M1-M7 ids. kora-infra's `app-website/src/utils/testResultCompat.ts`
// tells v1 from v2 by *which field name is present*, so renaming back needs that
// discriminator re-keyed on the pack stamp or on key content first.
//

const VBehaviorLevel = v.picklist(["conversation"]);

const VBehavior = v.object({
  id: PackId.io,
  /** Display code (e.g. "M1"). Defaults to `id` when absent. */
  code: v.optional(v.string()),
  name: v.string(),
  level: VBehaviorLevel,
  /**
   * When set, the behavior is only assessable once this condition holds in the
   * transcript; otherwise the judge marks the criterion `notTriggered`. The
   * text is rendered into the judge prompt, so it must read as a condition.
   */
  precondition: v.optional(v.string()),
  assessmentPrompt: v.string(),
});

const VBehaviorSet = v.object({
  id: PackId.io,
  version: v.string(),
  name: v.optional(v.string()),
  behaviors: v.pipe(v.array(VBehavior), v.readonly()),
});

//
// API.
//

/** Display code for a behavior, falling back to its id. */
function codeOf(behavior: Behavior): string {
  return behavior.code ?? behavior.id;
}

function hasPrecondition(behavior: Behavior): boolean {
  return behavior.precondition !== undefined;
}

function parse(data: unknown): BehaviorSet {
  const set = v.parse(VBehaviorSet, data);
  if (set.behaviors.length === 0) {
    throw new Error(`Behavior set "${set.id}" contains no behaviors.`);
  }
  PackId.assertUnique(
    set.behaviors.map(b => b.id),
    "behavior",
    `Behavior set "${set.id}"`
  );
  return set;
}

function fingerprint(set: BehaviorSet): string {
  return Hash.shortHash(stableJson(set));
}

//
// Exports.
//

export type BehaviorLevel = v.InferOutput<typeof VBehaviorLevel>;
export interface Behavior extends v.InferOutput<typeof VBehavior> {}
export interface BehaviorSet extends v.InferOutput<typeof VBehaviorSet> {}

export const Behavior = {
  io: VBehavior,
  codeOf,
  hasPrecondition,
};

export const BehaviorSet = {
  io: VBehaviorSet,
  parse,
  fingerprint,
};
