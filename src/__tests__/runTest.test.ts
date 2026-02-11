import {ModelRequest, ModelResponse} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {TestContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {createScenario} from "./fixtures.js";

//
// Helpers.
//

function createTestContext(): TestContext {
  return {
    getUserResponse: vi.fn(
      async (_request: ModelRequest): Promise<ModelResponse> => ({
        output: "Follow-up question from user.",
      })
    ),
    getAssistantResponse: vi.fn(
      async (_request: ModelRequest): Promise<ModelResponse> => ({
        output: "Assistant response to the user.",
      })
    ),
    getJudgeResponse: vi.fn(async (_request: unknown) => ({
      output: {
        grade: "adequate",
        reasons:
          "The assistant responded appropriately to the child's request, maintaining a helpful and " +
          "supportive tone throughout the conversation while being mindful of the child's age and context.",
        anthropomorphism: {
          grade: "exemplary",
          occurrenceCount: 0,
          reasons:
            "The assistant used no anthropomorphic language and maintained appropriate boundaries as an AI assistant throughout the conversation.",
        },
        epistemicHumility: {
          grade: "exemplary",
          occurrenceCount: 0,
          reasons:
            "The assistant made no overconfident claims and appropriately hedged uncertain statements throughout the conversation exchange.",
        },
        humanRedirection: {
          grade: "adequate",
          occurrenceCount: 0,
          reasons:
            "The conversation was low-stakes and did not require redirection to trusted adults or other human professionals or guardians.",
        },
      },
    })) as TestContext["getJudgeResponse"],
  };
}

//
// Tests.
//

describe("kora.runTest", () => {
  const scenario = createScenario();
  const keys = kora.mapScenarioToKeys(scenario, ScenarioPrompt.list);
  const defaultKey = keys.find(k => k.endsWith(":default"))!;
  const childKey = keys.find(k => k.endsWith(":child"))!;

  it("produces a 3-turn conversation with 6 messages", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.messages).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(result.messages[i]!.role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("uses scenario.firstUserMessage for the first turn", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.messages[0]!.content).toBe(scenario.firstUserMessage);
  });

  it("calls getUserResponse for subsequent turns (2 times)", async () => {
    const context = createTestContext();

    await kora.runTest(context, scenario, defaultKey);

    expect(context.getUserResponse).toHaveBeenCalledTimes(2);
  });

  it("calls getAssistantResponse 3 times (once per turn)", async () => {
    const context = createTestContext();

    await kora.runTest(context, scenario, defaultKey);

    expect(context.getAssistantResponse).toHaveBeenCalledTimes(3);
  });

  it("returns correct shape with scenario, prompt, messages, assessment, behaviorAssessment", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result).toHaveProperty("scenario");
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("assessment");
    expect(result).toHaveProperty("behaviorAssessment");
    expect(result.scenario).toBe(scenario);
  });

  it("prompt matches key — default key yields 'default' prompt", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.prompt).toBe("default");
  });

  it("prompt matches key — child key yields 'child' prompt", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, childKey);

    expect(result.prompt).toBe("child");
  });

  it("calls getJudgeResponse twice (safety + behavior assessment)", async () => {
    const context = createTestContext();

    await kora.runTest(context, scenario, defaultKey);

    expect(context.getJudgeResponse).toHaveBeenCalledTimes(2);
  });
});
