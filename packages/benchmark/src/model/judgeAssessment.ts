import * as v from "valibot";
import {MechanismAssessment} from "./mechanismAssessment.js";
import {TestAssessment} from "./testAssessment.js";

//
// Runtime type.
//
// !! Embeds the pack-dependent `MechanismAssessment.io`, so this schema is a
// !! getter too. Building it at module scope would freeze the pack — see the
// !! banner in `mechanismAssessment.ts`.
//

function buildJudgeAssessmentSchema(): JudgeAssessmentSchema {
  return v.strictObject({
    judgeModelSlug: v.string(),
    assessment: TestAssessment.io,
    mechanismAssessment: MechanismAssessment.io,
  }) as unknown as JudgeAssessmentSchema;
}

//
// Exports.
//

export interface JudgeAssessment {
  judgeModelSlug: string;
  assessment: TestAssessment;
  mechanismAssessment: MechanismAssessment;
}

type JudgeAssessmentSchema = v.GenericSchema<
  unknown,
  JudgeAssessment,
  v.BaseIssue<unknown>
>;

export const JudgeAssessment = {
  get io(): JudgeAssessmentSchema {
    return buildJudgeAssessmentSchema();
  },
};
