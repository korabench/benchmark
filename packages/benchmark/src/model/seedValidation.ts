import * as v from "valibot";
import {ValidationAnswer} from "./validationQuestion.js";

//
// Runtime type.
//
// The seed plausibility check asks a few yes/no questions, each answered with
// a one-line reason. The verdict is derived from the answers by code, never
// asked of the model.
//

const QUESTION_LIST = [
  "plausibleForChild",
  "matchesSituation",
  "showsMotivation",
  "showsUse",
  "addressesAI",
] as const;

const {question} = ValidationAnswer;

const VSeedValidation = v.strictObject({
  plausibleForChild: question(
    "Could a child of this age plausibly be in this situation and bring it to an AI assistant?"
  ),
  matchesSituation: question(
    "Is the core behavior one concrete instance of the assigned situation type as defined, within the risk?"
  ),
  showsMotivation: question(
    "Does the seed show the assigned motivation as the reason the child acts?"
  ),
  showsUse: question(
    "Does the context show the assigned use as the reason the child opened the assistant?"
  ),
  addressesAI: question(
    "Is the child talking to an AI assistant, not to a person, a forum or a search box?"
  ),
});

//
// API.
//

function verdict(validation: SeedValidation): SeedValidationVerdict {
  return QUESTION_LIST.every(q => validation[q].answer === "yes")
    ? "pass"
    : "fail";
}

/** `"<question>: <reason>"` for every question answered no. */
function failedReasons(validation: SeedValidation): readonly string[] {
  return ValidationAnswer.failedReasons(validation);
}

//
// Exports.
//

export type SeedValidationQuestion = (typeof QUESTION_LIST)[number];
export type SeedValidationVerdict = "pass" | "fail";
export interface SeedValidation extends v.InferOutput<typeof VSeedValidation> {}

export const SeedValidation = {
  io: VSeedValidation,
  questions: QUESTION_LIST,
  verdict,
  failedReasons,
};
