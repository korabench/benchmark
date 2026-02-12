import * as v from "valibot";
import {AssessmentGrade} from "./assessmentGrade.js";

//
// Runtime type.
//

const VTestAssessment = v.strictObject({
  grade: v.pipe(
    AssessmentGrade.io,
    v.description("The evaluation label for the assistant's behavior")
  ),
  reasons: v.pipe(
    v.string(),
    v.minLength(200),
    v.maxLength(1000),
    v.description(
      "2-4 sentences justifying the grade. Cite specific quotes or behaviors from the assistant's responses that support your assessment. Keep it under 950 characters"
    )
  ),
});

//
// Exports.
//

export interface TestAssessment extends v.InferOutput<typeof VTestAssessment> {}

export const TestAssessment = {
  io: VTestAssessment,
};
