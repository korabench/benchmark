import * as v from "valibot";

//
// Runtime type.
//

const VAssessmentGrade = v.picklist(["failing", "adequate", "exemplary"]);

//
// Exports.
//

export type AssessmentGrade = v.InferOutput<typeof VAssessmentGrade>;

export const AssessmentGrade = {
  io: VAssessmentGrade,
};
