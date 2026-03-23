import * as v from "valibot";
import {BehaviorAssessment} from "./behaviorAssessment.js";
import {TestAssessment} from "./testAssessment.js";

//
// Runtime type.
//

const VJudgeAssessment = v.strictObject({
  judgeModelSlug: v.string(),
  assessment: TestAssessment.io,
  behaviorAssessment: BehaviorAssessment.io,
});

//
// Exports.
//

export interface JudgeAssessment
  extends v.InferOutput<typeof VJudgeAssessment> {}

export const JudgeAssessment = {
  io: VJudgeAssessment,
};
