import {ModelMessage, ModelRequest, ModelResponse} from "@korabench/core";
import type {ChildResponse} from "./child/mimesisPatch.js";
import {SystemUserPrompt} from "./model/prompt.js";
import {Risk} from "./model/risk.js";
import {Scenario} from "./model/scenario.js";
import {
  FirstUserMessageFeedback,
  scenarioToFirstUserMessagePrompt,
} from "./prompts/scenarioToFirstUserMessagePrompt.js";
import {scenarioToNextUserMessagePrompt} from "./prompts/scenarioToNextUserMessagePrompt.js";

interface UserResponseContext {
  getChildResponse?: import("./benchmark.js").TestContext["getChildResponse"];
  getUserResponse: (request: ModelRequest) => Promise<ModelResponse>;
  /** Natural language the simulated child writes in (e.g. "Estonian").
   * Undefined keeps the default English. */
  language?: string;
}

// Catches unsubstituted placeholders like `[name]` or `[specific group]`
// (the prompt tells the simulated child not to emit these). Requires 2+
// non-digit chars inside so code and citations — `[1, 2, 3]`, `numbers[10]`,
// `[12]` — pass through. See issue #52.
const placeholderRegex = /\[[^\]\d]{2,}\]/;
const maxAttempts = 3;

/** True when a child message still holds a bracketed placeholder, e.g.
 * "[name]": a template the writer did not fill in. */
export function hasPlaceholder(message: string): boolean {
  return placeholderRegex.test(message);
}

async function generateUserMessage(
  c: UserResponseContext,
  prompt: SystemUserPrompt
): Promise<string> {
  let previousAttempt: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: prompt.system,
      },
      {
        role: "user",
        content: prompt.user,
      },
    ];

    if (previousAttempt) {
      messages.push(
        {
          role: "assistant",
          content: previousAttempt,
        },
        {
          role: "user",
          content:
            "Your previous response contained bracketed placeholders like [name] or [specific group]. " +
            "These MUST be replaced with concrete, realistic text. " +
            "Rewrite the message with all placeholders filled in.",
        }
      );
    }

    const {output} = await c.getUserResponse({
      maxTokens: 300,
      messages,
    });

    if (!placeholderRegex.test(output)) {
      return output;
    }

    previousAttempt = output;

    if (attempt === maxAttempts) {
      throw new Error(
        `User message still contains bracketed placeholders after ${maxAttempts} attempts: ${output}`
      );
    }
  }

  throw new Error("Unreachable");
}

/**
 * Write the child's opening message. With `feedback`, a message written
 * earlier for this seed was rejected by the scenario validation: the writer is
 * shown it and the reasons.
 */
export function generateFirstUserMessage(
  c: UserResponseContext,
  risk: Risk,
  scenario: Scenario,
  feedback?: FirstUserMessageFeedback
) {
  return generateUserMessage(
    c,
    scenarioToFirstUserMessagePrompt(risk, scenario, c.language, feedback)
  );
}

export function generateNextUserMessage(
  c: UserResponseContext,
  risk: Risk,
  scenario: Scenario,
  messages: readonly ModelMessage[]
): Promise<ChildResponse> {
  if (c.getChildResponse) return c.getChildResponse({scenario, messages});
  return generateUserMessage(
    c,
    scenarioToNextUserMessagePrompt(risk, scenario, messages, c.language)
  ).then(output => ({output}));
}
