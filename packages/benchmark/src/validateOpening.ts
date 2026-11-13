import type {ExpandScenarioContext} from "./benchmark.js";
import {
  generateFirstUserMessage,
  PlaceholderError,
} from "./generateUserMessage.js";
import {Risk} from "./model/risk.js";
import {RiskCategory} from "./model/riskCategory.js";
import {Scenario} from "./model/scenario.js";
import {
  FirstMessageRisk,
  ScenarioValidation,
} from "./model/scenarioValidation.js";
import {firstMessageRiskPrompt} from "./prompts/firstMessageRiskPrompt.js";
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
  /** The first verdict, a fail, when this verdict is its second validation
   * (`validateConfirmed`). Absent when the scenario was validated once. */
  readonly rechecked?: OpeningVerdict;
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
  const riskPrompt = firstMessageRiskPrompt(scenario);
  const [{output: checklist}, {output: riskAnswer}] = await Promise.all([
    c.getResponse({
      messages: [
        {role: "system", content: prompt.system},
        {role: "user", content: prompt.user},
      ],
      outputType: ScenarioValidation.callIo,
    }),
    c.getResponse({
      messages: [
        {role: "system", content: riskPrompt.system},
        {role: "user", content: riskPrompt.user},
      ],
      outputType: FirstMessageRisk.io,
    }),
  ]);
  const validation: ScenarioValidation = {
    ...checklist,
    firstMessageTestsRisk: {
      reason: riskAnswer.reason,
      answer: riskAnswer.answer,
    },
  };
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

/**
 * The verdict a decision rests on: a rejected scenario is validated a second
 * time, and the second verdict decides. The validator is not stable (asked
 * again on the same V7.1 scenarios, it took back 59 of 409 rejections), so a
 * single "fail" is not enough to rewrite or re-expand a scenario. A pass is
 * not asked twice. Costs one more validation per first rejection.
 */
export async function validateConfirmed(
  c: Pick<ExpandScenarioContext, "getResponse">,
  scenario: Scenario,
  rejections: number,
  options?: {recheck?: boolean}
): Promise<OpeningVerdict> {
  const first = await validateScenario(c, scenario, rejections);
  if (first.verdict === "pass" || options?.recheck === false) {
    return first;
  }
  const second = await validateScenario(c, scenario, rejections);
  return {...second, rechecked: first};
}

/** Every verdict behind `verdict`, in the order they were given, each with
 * whether it is a recheck: the ledger records both. */
export function verdictsOf(
  verdict: OpeningVerdict
): readonly {readonly verdict: OpeningVerdict; readonly recheck: boolean}[] {
  return verdict.rechecked
    ? [
        {verdict: verdict.rechecked, recheck: false},
        {verdict, recheck: true},
      ]
    : [{verdict, recheck: false}];
}

/** The opening, or the placeholder error that stopped it. */
export async function openingOrPlaceholder(
  c: OpeningValidationContext,
  risk: Risk,
  scenario: Scenario,
  feedback: FirstUserMessageFeedback | undefined
): Promise<
  | {firstUserMessage: string; placeholder?: undefined}
  | {placeholder: PlaceholderError}
> {
  try {
    return {
      firstUserMessage: await generateFirstUserMessage(
        c,
        risk,
        scenario,
        feedback
      ),
    };
  } catch (error) {
    if (error instanceof PlaceholderError) {
      return {placeholder: error};
    }
    throw error;
  }
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
    /** Retry a rejection of the scenario too. For a scenario already accepted
     * at expansion, whose opening alone changed: the checklist then fails on
     * the new opening (e.g. a narrative the message no longer matches). */
    retryAnyRejection?: boolean;
    /** See `validateConfirmed`. Default true. */
    recheck?: boolean;
    /** Called once per verdict: twice for a rechecked opening, the second
     * with `recheck` set. */
    onVerdict?: (event: {
      attempt: number;
      firstUserMessage: string;
      verdict: OpeningVerdict;
      recheck: boolean;
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
    const written = await openingOrPlaceholder(c, risk, scenario, feedback);
    if (written.placeholder) {
      // An unfilled template is a rejected opening, not an error: written
      // again with the reason, as long as attempts remain.
      if (attempt >= options.maxAttempts) {
        throw written.placeholder;
      }
      rejections++;
      feedback = {
        previousMessage: written.placeholder.output,
        reasons: [PlaceholderError.reason],
      };
      continue;
    }
    const {firstUserMessage} = written;
    const verdict = await validateConfirmed(
      c,
      {...scenario, firstUserMessage},
      rejections,
      {recheck: options.recheck}
    );
    for (const given of verdictsOf(verdict)) {
      await options.onVerdict?.({
        attempt,
        firstUserMessage,
        verdict: given.verdict,
        recheck: given.recheck,
      });
    }
    if (
      verdict.verdict === "pass" ||
      (!verdict.firstMessageOnly && !options.retryAnyRejection) ||
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
