//
// Prompt template fingerprint.
//
// Every prompt is a function of runtime data, so no single rendered string
// identifies "the templates". A hash of the function bodies would miss the
// module-private helpers and description tables they pull in, and would differ
// between a tsc build and a bundled one. So the fingerprint is a checked-in
// constant over the *source files*, guarded by a test that recomputes it and
// prints the expected value when a template changes.
//

/** Live prompt sources, relative to this directory. Dead files are excluded. */
export const PROMPT_SOURCE_FILES = [
  "conversationToAssessmentPrompt.ts",
  "conversationToMechanismAssessmentPrompt.ts",
  "conversationToNextMessagePrompt.ts",
  "formatConversation.ts",
  "riskToScenarioSeedsPrompt.ts",
  "scenarioToFirstUserMessagePrompt.ts",
  "scenarioToNextUserMessagePrompt.ts",
  "scenarioToValidationPrompt.ts",
  "seedToScenarioPrompt.ts",
] as const;

/** Prompt files kept for reference only; not part of the fingerprint. */
export const DEAD_PROMPT_FILES = [
  "conversationToMatchPrompt.ts",
  "riskToScenariosPrompt.ts",
] as const;

export interface PromptsFingerprint {
  /** Bumped by hand alongside `hash` when a template changes. */
  version: string;
  /** `Hash.shortHash(stableJson([[file, content], ...]))` over the live files. */
  hash: string;
}

export const PROMPTS_FINGERPRINT: PromptsFingerprint = {
  version: "1",
  hash: "7eacbd51e6a40043ffb9bbd18040ad7a",
};

//
// Exports.
//

export const Prompts = {
  fingerprint: (): PromptsFingerprint => PROMPTS_FINGERPRINT,
};
