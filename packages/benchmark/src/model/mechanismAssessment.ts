import * as v from "valibot";
import {BehaviorSet} from "../packs/behaviorSet.js";
import {Packs} from "../packs/packs.js";
import {AssessmentGrade} from "./assessmentGrade.js";
import {Mechanism} from "./mechanism.js";

//
// Per-mechanism criterion assessment.
//

function notTriggeredDescription(mechanism: Mechanism): string {
  return Mechanism.hasPrecondition(mechanism)
    ? `True only when this criterion's precondition was not met — that is, when it is NOT the case that ${mechanism.precondition}. Excluded from scoring.`
    : "This criterion has no precondition, so always set false.";
}

function criterionSchema(mechanism: Mechanism) {
  return v.strictObject({
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
      v.description(notTriggeredDescription(mechanism))
    ),
  });
}

// The shape of a single criterion, independent of any pack. Used for typing and
// for lenient reads; the per-pack schemas above carry the real descriptions.
const VMechanismCriterionAssessment = criterionSchema({
  id: "",
  name: "",
  level: "conversation",
  assessmentPrompt: "",
});

//
// Full assessment.
//
// !! Built from the ACTIVE pack, and therefore exposed as a getter. Reading
// !! `MechanismAssessment.io` at module scope would freeze the schema against
// !! whichever pack happened to be active at import time — exactly the bug
// !! `packs/__tests__/moduleInit.test.ts` guards against. Keep every read inside
// !! a function body or behind a getter.
//
// Deliberately NOT `v.lazy`: this schema is passed straight to `outputType` and
// converted by `@valibot/to-json-schema`, which renders `lazy` as a root-level
// `$ref` that structured-output modes reject. A getter yields a plain schema.
//

const cache = new WeakMap<BehaviorSet, MechanismAssessmentSchema>();

function buildMechanismAssessmentSchema(): MechanismAssessmentSchema {
  const behaviorSet = Packs.current().behaviors;
  const cached = cache.get(behaviorSet);
  if (cached) {
    return cached;
  }

  const entries = behaviorSet.behaviors.map(
    m =>
      [
        m.id,
        v.pipe(
          criterionSchema(m),
          v.description(`Assessment of ${m.name} (${Mechanism.codeOf(m)})`)
        ),
      ] as const
  );
  const built = v.strictObject(
    Object.fromEntries(entries)
  ) as unknown as MechanismAssessmentSchema;

  cache.set(behaviorSet, built);
  return built;
}

//
// Exports.
//

export interface MechanismCriterionAssessment extends v.InferOutput<
  typeof VMechanismCriterionAssessment
> {}

export type MechanismAssessment = Readonly<
  Record<string, MechanismCriterionAssessment>
>;

type MechanismAssessmentSchema = v.GenericSchema<
  unknown,
  MechanismAssessment,
  v.BaseIssue<unknown>
>;

export const MechanismCriterionAssessment = {
  io: VMechanismCriterionAssessment,
};

export const MechanismAssessment = {
  get io(): MechanismAssessmentSchema {
    return buildMechanismAssessmentSchema();
  },
  /** Pack-independent, lenient shape. For typing and tolerant reads only. */
  shape: v.record(v.string(), VMechanismCriterionAssessment),
};
