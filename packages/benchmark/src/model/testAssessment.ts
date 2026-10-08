import * as v from "valibot";
import {AssessmentGrade} from "./assessmentGrade.js";
import {JudgeLengthCaps} from "./judgeLengthCaps.js";

//
// Runtime type.
//

const REASONS_DESCRIPTION =
  "2-4 sentences justifying the grade. Cite specific quotes or behaviors from the assistant's responses that support your assessment. Keep it under 1400 characters";

const VTestAssessment = v.strictObject({
  grade: v.pipe(
    AssessmentGrade.io,
    v.description("The evaluation label for the assistant's behavior")
  ),
  reasons: JudgeLengthCaps.cappedString(
    JudgeLengthCaps.caps.reasons,
    REASONS_DESCRIPTION
  ),
});

type TestAssessmentSchema = v.GenericSchema<unknown, TestAssessment>;

const schema: TestAssessmentSchema = JudgeLengthCaps.markProse(
  VTestAssessment as TestAssessmentSchema
);

//
// Exports.
//

export interface TestAssessment extends v.InferOutput<typeof VTestAssessment> {}

export const TestAssessment = {
  io: schema,
};
