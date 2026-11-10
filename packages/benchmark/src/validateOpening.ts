import type {ExpandScenarioContext} from "./benchmark.js";
import {generateFirstUserMessage} from "./generateUserMessage.js";
import {Risk} from "./model/risk.js";
import {RiskCategory} from "./model/riskCategory.js";
import {Scenario} from "./model/scenario.js";
import {ScenarioValidation} from "./model/scenarioValidation.js";
import {FirstUserMessageFeedback} from "./prompts/scenarioToFirstUserMessagePrompt.js";
import {scenarioToValidationPrompt} from "./prompts/scenarioToValidationPrompt.js";

//
// Opening validation.
//
// The scenario validation of `expand-scenarios`, one call by the expansion
// model on a scenario and its first user message, shared by expansion and by
// the commands that write or check an opening after it (`revise-openings`,
// `validate-openings`), so that an opening is held to the same questions
// whoever wrote it.
//

export type OpeningValidationContext = Pick<
  ExpandScenarioContext,
  "getResponse" | "getUserResponse" | "getChildResponse" | "language"
>;

export interface OpeningVerdict {
  readonly validation: ScenarioValidation;
  readonly verdict: "pass" | "fail";
  readonly reasons: string;
  readonly childVoiceRelaxed: boolean;
  /** Failed, and only on the questions about the first user message: a new
   * opening can fix it. A failure on the scenario cannot be fixed that way. */
  readonly firstMessageOnly: boolean;
}

/** One validation call on `scenario` as it stands, opening included.
 * `rejections` counts the earlier rejections of this seed, for the
 * (temporary) child-voice relaxation. */
export async function validateScenario(
  c: Pick<ExpandScenarioContext, "getResponse">,
  scenario: Scenario,
  rejections: number
): Promise<OpeningVerdict> {
  const {seed} = scenario;
  const riskCategory = RiskCategory.find(seed.riskCategoryId);
  const risk = RiskCategory.findRisk(riskCategory, seed.riskId);
  const relaxChildVoice = ScenarioValidation.relaxesChildVoice(
    seed.ageRange,
    rejections
  );
  const prompt = scenarioToValidationPrompt(
    riskCategory,
    risk,
    seed.ageRange,
    scenario,
    {relaxChildVoice}
  );
  const {output: validation} = await c.getResponse({
    messages: [
      {role: "system", content: prompt.system},
      {role: "user", content: prompt.user},
    ],
    outputType: ScenarioValidation.io,
  });
  const verdict = ScenarioValidation.verdict(validation, {relaxChildVoice});
  return {
    validation,
    verdict,
    reasons: ScenarioValidation.reasons(validation),
    childVoiceRelaxed: relaxChildVoice,
    firstMessageOnly:
      verdict === "fail" &&
      ScenarioValidation.rejectsFirstMessageOnly(validation, {
        relaxChildVoice,
      }),
  };
}

export interface WrittenOpening {
  readonly firstUserMessage: string;
  /** The verdict on the opening kept: the last one written. */
  readonly last: OpeningVerdict;
  /** Openings written, each validated. */
  readonly attempts: number;
}

/**
 * Write a new opening for an existing scenario and validate it, as expansion
 * does: an opening rejected on the first-message questions alone is written
 * again, with the reasons when the writer takes them (a child simulator's
 * fixed recipe does not, and draws again). It stops at the first pass, after
 * `maxAttempts`, or on a rejection of the scenario itself, which no opening
 * can fix; the scenario and its seed are never changed. The last opening is
 * returned whatever its verdict: the caller decides what to do with a fail.
 */
export async function writeValidatedOpening(
  c: OpeningValidationContext,
  scenario: Scenario,
  options: {
    maxAttempts: number;
    priorRejections?: number;
    onVerdict?: (event: {
      attempt: number;
      firstUserMessage: string;
      verdict: OpeningVerdict;
    }) => void | Promise<void>;
  }
): Promise<WrittenOpening> {
  const risk: Risk = RiskCategory.findRisk(
    RiskCategory.find(scenario.seed.riskCategoryId),
    scenario.seed.riskId
  );
  let feedback: FirstUserMessageFeedback | undefined;
  let rejections = options.priorRejections ?? 0;
  for (let attempt = 1; ; attempt++) {
    const firstUserMessage = await generateFirstUserMessage(
      c,
      risk,
      scenario,
      feedback
    );
    const verdict = await validateScenario(
      c,
      {...scenario, firstUserMessage},
      rejections
    );
    await options.onVerdict?.({attempt, firstUserMessage, verdict});
    if (
      verdict.verdict === "pass" ||
      !verdict.firstMessageOnly ||
      attempt >= options.maxAttempts
    ) {
      return {firstUserMessage, last: verdict, attempts: attempt};
    }
    rejections++;
    feedback = {
      previousMessage: firstUserMessage,
      reasons: ScenarioValidation.firstMessageReasons(verdict.validation, {
        relaxChildVoice: verdict.childVoiceRelaxed,
      }),
    };
  }
}
