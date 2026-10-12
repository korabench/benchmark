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
  "seedDimensionLines.ts",
  "seedToScenarioPrompt.ts",
  "seedToValidationPrompt.ts",
] as const;

/**
 * Data files the prompts quote verbatim, relative to this directory: the
 * safety judge's gold-standard rubrics and the situation types (whose
 * boundaries the judge quotes and whose descriptions the generation prompts
 * quote). Editing one changes what a judge or generator reads, so they are
 * part of the fingerprint like the templates.
 */
export const PROMPT_DATA_FILES = [
  "../../data/goldStandardRubrics/1.1.json",
  "../../data/goldStandardRubrics/1.2a.json",
  "../../data/goldStandardRubrics/1.2b.json",
  "../../data/goldStandardRubrics/1.2c.json",
  "../../data/goldStandardRubrics/1.3.json",
  "../../data/goldStandardRubrics/2.1.json",
  "../../data/goldStandardRubrics/2.2.json",
  "../../data/goldStandardRubrics/2.3.json",
  "../../data/goldStandardRubrics/2.4.json",
  "../../data/goldStandardRubrics/3.1.json",
  "../../data/goldStandardRubrics/3.2.json",
  "../../data/goldStandardRubrics/3.3.json",
  "../../data/goldStandardRubrics/3.4.json",
  "../../data/goldStandardRubrics/4.1.json",
  "../../data/goldStandardRubrics/4.2.json",
  "../../data/goldStandardRubrics/5.1.json",
  "../../data/goldStandardRubrics/5.2.json",
  "../../data/goldStandardRubrics/5.3.json",
  "../../data/goldStandardRubrics/6.1.json",
  "../../data/goldStandardRubrics/6.2.json",
  "../../data/goldStandardRubrics/6.3.json",
  "../../data/goldStandardRubrics/7.1.json",
  "../../data/goldStandardRubrics/7.2.json",
  "../../data/goldStandardRubrics/7.3.json",
  "../../data/goldStandardRubrics/8.1.json",
  "../../data/goldStandardRubrics/8.2.json",
  "../../data/goldStandardRubrics/8.3.json",
  "../../data/goldStandardRubrics/8.4.json",
  "../../data/situationTypes.json",
] as const;

/** Prompt files kept for reference only; not part of the fingerprint. */
export const DEAD_PROMPT_FILES = [
  "conversationToMatchPrompt.ts",
  "riskToScenariosPrompt.ts",
] as const;

export interface PromptsFingerprint {
  /** Bumped by hand alongside `hash` when a template changes. */
  version: string;
  /**
   * `Hash.shortHash(stableJson([[file, content], ...]))` over the live files,
   * then the data files.
   */
  hash: string;
}

export const PROMPTS_FINGERPRINT: PromptsFingerprint = {
  version: "3",
  hash: "119363fe768af3eb520a3a2c2275d787",
};

//
// Exports.
//

export const Prompts = {
  fingerprint: (): PromptsFingerprint => PROMPTS_FINGERPRINT,
};
