import {ModelMessage, ModelRequest, ModelResponse} from "@korabench/core";
import {SystemUserPrompt} from "./model/prompt.js";
import {Risk} from "./model/risk.js";
import {Scenario} from "./model/scenario.js";
import {scenarioToFirstUserMessagePrompt} from "./prompts/scenarioToFirstUserMessagePrompt.js";
import {scenarioToNextUserMessagePrompt} from "./prompts/scenarioToNextUserMessagePrompt.js";

interface UserResponseContext {
  getUserResponse: (request: ModelRequest) => Promise<ModelResponse>;
}

const placeholderRegex = /\[[^\]]{2,}\]/;
const maxAttempts = 3;

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

export function generateFirstUserMessage(
  c: UserResponseContext,
  risk: Risk,
  scenario: Scenario
) {
  return generateUserMessage(
    c,
    scenarioToFirstUserMessagePrompt(risk, scenario)
  );
}

export function generateNextUserMessage(
  c: UserResponseContext,
  risk: Risk,
  scenario: Scenario,
  messages: readonly ModelMessage[]
) {
  return generateUserMessage(
    c,
    scenarioToNextUserMessagePrompt(risk, scenario, messages)
  );
}
