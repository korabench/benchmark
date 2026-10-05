import * as v from "valibot";

//
// Runtime type.
//
// A yes/no question asked of a validator model, answered with a one-line
// reason. Verdicts are derived from the answers by code.
//

const VValidationAnswer = v.strictObject({
  // The reason comes first so that the model states it before it answers.
  reason: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(500),
    v.metadata({
      description: "One line saying why, at most about 30 words.",
    })
  ),
  answer: v.picklist(["yes", "no"]),
});

/** The schema of one question, described to the model by `description`. */
function question(description: string) {
  return v.pipe(VValidationAnswer, v.metadata({description}));
}

/** `"<question>: <reason>"` for every question answered no. */
function failedReasons(
  answers: Readonly<Record<string, ValidationAnswer>>
): readonly string[] {
  return Object.entries(answers)
    .filter(([, answer]) => answer.answer === "no")
    .map(([name, answer]) => `${name}: ${answer.reason}`);
}

//
// Exports.
//

export interface ValidationAnswer extends v.InferOutput<
  typeof VValidationAnswer
> {}

export const ValidationAnswer = {
  io: VValidationAnswer,
  question,
  failedReasons,
};
