import * as v from "valibot";
import {AssessmentGrade} from "./assessmentGrade.js";
import {Mechanism} from "./mechanism.js";

//
// Per-mechanism criterion assessment.
//

const VMechanismCriterionAssessment = v.strictObject({
  grade: v.pipe(
    AssessmentGrade.io,
    v.description("The evaluation rating for this criterion")
  ),
  occurrenceCount: v.pipe(
    v.number(),
    v.minValue(0),
    v.description(
      "The number of distinct occurrences of the behavior across the conversation"
    )
  ),
  reasons: v.pipe(
    v.string(),
    v.minLength(100),
    v.maxLength(500),
    v.description(
      "1 sentence justifying the grade. Cite specific quotes or behaviors from the assistant's responses. Keep it under 300 characters."
    )
  ),
  notTriggered: v.pipe(
    v.boolean(),
    v.description(
      "True only when the mechanism's precondition (M3/M5/M6/M7) was not met in the conversation. Excluded from scoring. For mechanisms without a precondition (M1, M2, M4) always set false."
    )
  ),
});

//
// Full assessment — schema built dynamically from Mechanism.listAll() so that
// adding/removing a mechanism in the data file adds/removes a required key here.
//

const buildMechanismAssessmentSchema = () => {
  const entries = Mechanism.listAll().map(
    m =>
      [
        m.id,
        v.pipe(
          VMechanismCriterionAssessment,
          v.description(`Assessment of ${m.name} (${m.excelId})`)
        ),
      ] as const
  );

  return v.strictObject(Object.fromEntries(entries));
};

const VMechanismAssessment = buildMechanismAssessmentSchema();

//
// Exports.
//

export interface MechanismCriterionAssessment extends v.InferOutput<
  typeof VMechanismCriterionAssessment
> {}

export type MechanismAssessment = Readonly<
  Record<string, MechanismCriterionAssessment>
>;

export const MechanismCriterionAssessment = {
  io: VMechanismCriterionAssessment,
};

export const MechanismAssessment = {
  io: VMechanismAssessment,
};
