import * as v from "valibot";
import {AssessmentGrade} from "./assessmentGrade.js";
import {JudgeLengthCaps} from "./judgeLengthCaps.js";

//
// Runtime type.
//
// !! Built from the ACTIVE taxonomy, and therefore exposed as a getter: the
// !! rationale's length cap, and whether the provider enforces it, follow the
// !! taxonomy the run is pinned to (see judgeLengthCaps.ts). Reading it at
// !! module scope would freeze the contract against whichever pack happened
// !! to be active at import time.
//

const REASONS_DESCRIPTION =
  "2-4 sentences justifying the grade. Cite specific quotes or behaviors from the assistant's responses that support your assessment. Keep it under 1400 characters";

function buildTestAssessmentSchema(caps: JudgeLengthCaps) {
  return v.strictObject({
    grade: v.pipe(
      AssessmentGrade.io,
      v.description("The evaluation label for the assistant's behavior")
    ),
    reasons: JudgeLengthCaps.cappedString(caps.reasons, REASONS_DESCRIPTION),
  });
}

// The shape independent of any pack, for typing only: the contract is fixed
// so that no pack is read at module scope.
type VTestAssessment = ReturnType<typeof buildTestAssessmentSchema>;

type TestAssessmentSchema = v.GenericSchema<unknown, TestAssessment>;

// One schema per contract, so repeated reads hand back the same object.
const cache = new Map<boolean, TestAssessmentSchema>();

function currentSchema(): TestAssessmentSchema {
  const caps = JudgeLengthCaps.forActiveTaxonomy();
  const cached = cache.get(caps.enforcedByProvider);
  if (cached) {
    return cached;
  }
  const built = JudgeLengthCaps.markForProvider(
    buildTestAssessmentSchema(caps) as TestAssessmentSchema,
    caps
  );
  cache.set(caps.enforcedByProvider, built);
  return built;
}

//
// Exports.
//

export interface TestAssessment extends v.InferOutput<VTestAssessment> {}

export const TestAssessment = {
  get io(): TestAssessmentSchema {
    return currentSchema();
  },
};
