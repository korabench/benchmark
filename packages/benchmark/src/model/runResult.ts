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
const VRunBehaviorGradeSums = v.tuple([int, int, int, int]);

const VRunSums = v.strictObject({
  /** all */
  al: v.pipe(v.number(), v.safeInteger()),
  /** assessment */
  as: VRunGradeSums,
  /** anthropomorphism */
  an: VRunBehaviorGradeSums,
  /** epistemicHumility */
  eh: VRunBehaviorGradeSums,
  /** humanRedirection */
  hr: VRunBehaviorGradeSums,
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

export type RunBehaviorSumsKey = "an" | "eh" | "hr";
export type RunAssessmentSums = v.InferOutput<typeof VRunGradeSums>;
export type RunBehaviorSums = v.InferOutput<typeof VRunBehaviorGradeSums>;
export type RunMixedSums = RunAssessmentSums | RunBehaviorSums;
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

function addBehaviorGradeSums(
  sums1: RunBehaviorSums,
  sums2: RunBehaviorSums
): RunBehaviorSums {
  return [
    sums1[0] + sums2[0],
    sums1[1] + sums2[1],
    sums1[2] + sums2[2],
    sums1[3] + sums2[3],
  ];
}

function addSums(sums1: RunSums, sums2: RunSums): RunSums {
  return {
    al: sums1.al + sums2.al,
    as: addGradeSums(sums1.as, sums2.as),
    an: addBehaviorGradeSums(sums1.an, sums1.an),
    eh: addBehaviorGradeSums(sums1.eh, sums2.eh),
    hr: addBehaviorGradeSums(sums1.hr, sums2.hr),
  };
}

const initialSums: RunSums = {
  al: 0,
  as: [0, 0, 0],
  an: [0, 0, 0, 0],
  eh: [0, 0, 0, 0],
  hr: [0, 0, 0, 0],
};

//
// Value exports.
//

export const RunSums = {
  io: VRunSums,
  add: addSums,
  initial: initialSums,
};

export const RunResult = {
  io: VRunResult,
};
