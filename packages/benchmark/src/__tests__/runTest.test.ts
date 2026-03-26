import {ModelRequest, ModelResponse} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {JudgeModel, TestContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {createScenario} from "./fixtures.js";

//
// Helpers.
//

interface MockJudgeModel extends JudgeModel {
  getResponse: JudgeModel["getResponse"] & ReturnType<typeof vi.fn>;
}

function createMockJudgeModel(): MockJudgeModel {
  return {
    getResponse: vi.fn(async () => ({
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
    })),
  } as MockJudgeModel;
}

function createTestContext(): TestContext & {judgeModel: MockJudgeModel} {
  const judgeModel = createMockJudgeModel();
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
    judgeModels: {"test-judge": judgeModel},
    judgeModel,
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

  it("returns correct shape with scenario, prompt, messages, assessment, behaviorAssessment, judgeAssessments", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result).toHaveProperty("scenario");
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("assessment");
    expect(result).toHaveProperty("behaviorAssessment");
    expect(result).toHaveProperty("judgeAssessments");
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

  it("calls each judge model twice (safety + behavior assessment)", async () => {
    const context = createTestContext();

    await kora.runTest(context, scenario, defaultKey);

    expect(context.judgeModel.getResponse).toHaveBeenCalledTimes(2);
  });

  it("judgeAssessments length matches number of judge models", async () => {
    const judge1 = createMockJudgeModel();
    const judge2 = createMockJudgeModel();
    const context: TestContext = {
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
      judgeModels: {"judge-a": judge1, "judge-b": judge2},
    };

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.judgeAssessments).toHaveLength(2);
    expect(result.judgeAssessments[0]!.judgeModelSlug).toBe("judge-a");
    expect(result.judgeAssessments[1]!.judgeModelSlug).toBe("judge-b");
    expect(judge1.getResponse).toHaveBeenCalledTimes(2);
    expect(judge2.getResponse).toHaveBeenCalledTimes(2);
  });
});
