import {ModelRequest, ModelResponse} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {
  generateFirstUserMessage,
  generateNextUserMessage,
} from "../generateUserMessage.js";
import {RiskCategory} from "../model/riskCategory.js";
import {createScenario, testRiskCategoryId, testRiskId} from "./fixtures.js";

//
// Helpers.
//

const riskCategory = RiskCategory.find(testRiskCategoryId);
const risk = RiskCategory.findRisk(riskCategory, testRiskId);
const scenario = createScenario();

function mockContext(responses: string[]) {
  let callIndex = 0;
  const getUserResponse = vi.fn(
    async (_request: ModelRequest): Promise<ModelResponse> => {
      const output = responses[callIndex] ?? "";
      callIndex++;
      return {output};
    }
  );
  return {getUserResponse};
}

//
// Tests.
//

describe("generateFirstUserMessage", () => {
  it("returns clean text on first attempt when no placeholders", async () => {
    const context = mockContext(["Hey, I wanted to ask about something."]);

    const result = await generateFirstUserMessage(context, risk, scenario);

    expect(result).toBe("Hey, I wanted to ask about something.");
    expect(context.getUserResponse).toHaveBeenCalledTimes(1);
  });

  it("retries when output contains a bracketed placeholder and succeeds on attempt 2", async () => {
    const context = mockContext([
      "Hey [name], can you help me?",
      "Hey Sarah, can you help me?",
    ]);

    const result = await generateFirstUserMessage(context, risk, scenario);

    expect(result).toBe("Hey Sarah, can you help me?");
    expect(context.getUserResponse).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 attempts if placeholders persist", async () => {
    const context = mockContext([
      "Hello [name]",
      "Hello [specific name]",
      "Hello [your name]",
    ]);

    await expect(
      generateFirstUserMessage(context, risk, scenario)
    ).rejects.toThrow(
      /still contains bracketed placeholders after 3 attempts/
    );
    expect(context.getUserResponse).toHaveBeenCalledTimes(3);
  });

  it("does not retry for single-char brackets like [x]", async () => {
    const context = mockContext(["Option [a] or [b] sounds good."]);

    const result = await generateFirstUserMessage(context, risk, scenario);

    expect(result).toBe("Option [a] or [b] sounds good.");
    expect(context.getUserResponse).toHaveBeenCalledTimes(1);
  });

  it("includes previous attempt and feedback instruction in retry messages", async () => {
    const context = mockContext([
      "Hi [name], what's up?",
      "Hi Emma, what's up?",
    ]);

    await generateFirstUserMessage(context, risk, scenario);

    const secondCall = context.getUserResponse.mock.calls[1]![0];
    expect(secondCall.messages).toHaveLength(4);
    expect(secondCall.messages[2]).toMatchObject({
      role: "assistant",
      content: "Hi [name], what's up?",
    });
    expect(secondCall.messages[3]).toMatchObject({
      role: "user",
      content: expect.stringContaining("bracketed placeholders"),
    });
  });

  it("passes maxTokens: 300 to context", async () => {
    const context = mockContext(["Clean response"]);

    await generateFirstUserMessage(context, risk, scenario);

    expect(context.getUserResponse.mock.calls[0]![0].maxTokens).toBe(300);
  });
});

describe("generateNextUserMessage", () => {
  it("returns clean text on first attempt", async () => {
    const context = mockContext(["What do you think about that?"]);
    const messages = [
      {role: "user" as const, content: "Hello"},
      {role: "assistant" as const, content: "Hi there!"},
    ];

    const result = await generateNextUserMessage(
      context,
      risk,
      scenario,
      messages
    );

    expect(result).toBe("What do you think about that?");
    expect(context.getUserResponse).toHaveBeenCalledTimes(1);
  });
});
