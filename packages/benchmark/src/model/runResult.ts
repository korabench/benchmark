import * as v from "valibot";
import {AgeRange} from "./ageRange.js";
import {ScenarioPrompt} from "./scenarioPrompt.js";

//
// Runtime type.
//

const int = v.pipe(v.number(), v.safeInteger());

// [failing, adequate, exemplary]
const VRunGradeSums = v.tuple([int, int, int]);

// [failing, adequate, exemplary, occurrenceCount]
const VRunMechanismGradeSums = v.tuple([int, int, int, int]);

const VRunSums = v.strictObject({
  /** all */
  al: v.pipe(v.number(), v.safeInteger()),
  /** assessment */
  as: VRunGradeSums,
  /** per-mechanism sums, keyed by mechanism id */
  mechanisms: v.record(v.string(), VRunMechanismGradeSums),
});

const VRunResultScore = v.strictObject({
  riskCategoryId: v.string(),
  riskId: v.string(),
  ageRange: AgeRange.io,
  prompt: ScenarioPrompt.io,
  sums: VRunSums,
});

const VRunResult = v.object({
  scores: v.pipe(v.array(VRunResultScore), v.readonly()),
});

//
// Exports.
//

export type RunAssessmentSums = v.InferOutput<typeof VRunGradeSums>;
export type RunMechanismSums = v.InferOutput<typeof VRunMechanismGradeSums>;
export interface RunSums extends v.InferOutput<typeof VRunSums> {}
export interface RunResultScore extends v.InferOutput<typeof VRunResultScore> {}
export interface RunResult extends v.InferOutput<typeof VRunResult> {}

//
// API.
//

function addGradeSums(
  sums1: RunAssessmentSums,
  sums2: RunAssessmentSums
): RunAssessmentSums {
  return [sums1[0] + sums2[0], sums1[1] + sums2[1], sums1[2] + sums2[2]];
}

function addMechanismGradeSums(
  sums1: RunMechanismSums,
  sums2: RunMechanismSums
): RunMechanismSums {
  return [
    sums1[0] + sums2[0],
    sums1[1] + sums2[1],
    sums1[2] + sums2[2],
    sums1[3] + sums2[3],
  ];
}

function addMechanismSumsRecord(
  a: Record<string, RunMechanismSums>,
  b: Record<string, RunMechanismSums>
): Record<string, RunMechanismSums> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const zero: RunMechanismSums = [0, 0, 0, 0];
  return Object.fromEntries(
    [...keys].map(key => [
      key,
      addMechanismGradeSums(a[key] ?? zero, b[key] ?? zero),
    ])
  );
}

function addSums(sums1: RunSums, sums2: RunSums): RunSums {
  return {
    al: sums1.al + sums2.al,
    as: addGradeSums(sums1.as, sums2.as),
    mechanisms: addMechanismSumsRecord(sums1.mechanisms, sums2.mechanisms),
  };
}

//
// Value exports.
//

export const RunSums = {
  io: VRunSums,
  add: addSums,
};

export const RunResult = {
  io: VRunResult,
};
