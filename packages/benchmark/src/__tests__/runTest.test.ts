import {ModelRequest, ModelResponse} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {JudgeModel, JudgeRequest, TestContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {InvalidTurnError} from "../model/invalidTurnError.js";
import {Mechanism} from "../model/mechanism.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {TestAssessment} from "../model/testAssessment.js";
import {makeStamp} from "../stamp/__tests__/fixtures.js";
import {Stamp} from "../stamp/stamp.js";
import {createJudgeOutput, createScenario} from "./fixtures.js";

//
// Helpers.
//

interface MockJudgeModel extends JudgeModel {
  getResponse: JudgeModel["getResponse"] & ReturnType<typeof vi.fn>;
}

function mechanismAssessmentOutput(): Record<
  string,
  {grade: string; occurrenceCount: number; reasons: string}
> {
  return Object.fromEntries(
    Mechanism.listAll().map(m => [
      m.id,
      {
        grade: "adequate",
        occurrenceCount: 0,
        reasons: `Placeholder judge reasoning for ${m.name} — adequate grade with zero occurrences in the conversation under evaluation.`,
      },
    ])
  );
}

// The judge makes TWO calls per conversation: one for the safety assessment,
// one for the mechanism assessment. The mock answers each by its output type.
function createMockJudgeModel(): MockJudgeModel {
  return {
    getResponse: vi.fn(async (request: JudgeRequest<unknown>) => ({
      output:
        request.outputType === TestAssessment.judgeIo
          ? createJudgeOutput()
          : mechanismAssessmentOutput(),
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

  it("uses an explicit native child pipeline for every turn and resumes from the saved visible messages", async () => {
    const context = createTestContext();
    const histories: number[] = [];
    context.getChildResponse = vi.fn(async ({messages}) => {
      histories.push(messages.length);
      return {output: `Native child turn ${messages.length / 2}`};
    });
    const first = await kora.runTest(context, scenario, defaultKey);
    expect(histories).toEqual([0, 2, 4]);
    expect(first.messages[0]!.content).toBe("Native child turn 0");
    expect(context.getUserResponse).not.toHaveBeenCalled();
    histories.length = 0;
    const resumed = await kora.runTest(
      context,
      scenario,
      defaultKey,
      first.messages.slice(0, 2)
    );
    expect(histories).toEqual([2, 4]);
    expect(resumed.messages.slice(0, 2)).toEqual(first.messages.slice(0, 2));
  });

  it("omits the stamp when none is configured", async () => {
    const result = await kora.runTest(
      createTestContext(),
      scenario,
      defaultKey
    );
    expect("stamp" in result).toBe(false);
  });

  it("attaches the active stamp", async () => {
    const stamp = makeStamp();
    const result = await Stamp.run(stamp, () =>
      kora.runTest(createTestContext(), scenario, defaultKey)
    );
    expect(result.stamp).toBe(stamp);
  });

  it("produces a 3-turn conversation with 6 messages", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.messages).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(result.messages[i]!.role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("abandons the conversation when a turn is a capture defect", async () => {
    const context = createTestContext();
    let turn = 0;
    context.getAssistantResponse = vi.fn(async () => ({
      output:
        turn++ === 1 ? "Triangulating" : "Assistant response to the user.",
    }));

    const error = await kora
      .runTest(context, scenario, defaultKey)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidTurnError);
    expect((error as InvalidTurnError).issue).toEqual({
      code: "thinking_label",
      // messages is [user, assistant, user] when the bad turn is validated.
      turnIndex: 3,
      captured: "Triangulating",
    });
  });

  it("never judges a conversation containing a capture defect", async () => {
    const context = createTestContext();
    context.getAssistantResponse = vi.fn(async () => ({output: "Retry"}));

    await expect(
      kora.runTest(context, scenario, defaultKey)
    ).rejects.toBeInstanceOf(InvalidTurnError);

    expect(context.judgeModel.getResponse).not.toHaveBeenCalled();
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

  it("returns correct shape with scenario, prompt, messages, assessment, mechanismAssessment, judgeAssessments", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result).toHaveProperty("scenario");
    expect(result).toHaveProperty("prompt");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("assessment");
    expect(result).toHaveProperty("mechanismAssessment");
    expect(result).toHaveProperty("judgeAssessments");
    expect(result.scenario).toBe(scenario);
  });

  it("mechanismAssessment contains every declared mechanism", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    for (const mechanism of Mechanism.listAll()) {
      expect(result.mechanismAssessment[mechanism.id]).toBeDefined();
    }
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

  it("calls each judge model twice (safety + mechanism assessment)", async () => {
    const context = createTestContext();

    await kora.runTest(context, scenario, defaultKey);

    expect(context.judgeModel.getResponse).toHaveBeenCalledTimes(2);
  });

  it("asks the safety judge for the gold-standard output, keyed for caching", async () => {
    const context = createTestContext();

    const result = await kora.runTest(context, scenario, defaultKey);

    const safetyCall = context.judgeModel.getResponse.mock.calls
      .map(([request]) => request as JudgeRequest<unknown>)
      .find(request => request.outputType === TestAssessment.judgeIo);
    expect(safetyCall?.promptCacheKey).toBe("kora-judge-1.1");
    expect(result.assessment.grade).toBe("adequate");
    expect(result.assessment.findings?.terminalQuestion).toBe("Q4");
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

  it("asks only the mechanism judges for the behaviours", async () => {
    const judge1 = createMockJudgeModel();
    const judge2 = createMockJudgeModel();
    const context: TestContext = {
      ...createTestContext(),
      judgeModels: {"judge-a": judge1, "judge-b": judge2},
      mechanismJudges: ["judge-a"],
    };

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(judge1.getResponse).toHaveBeenCalledTimes(2);
    expect(judge2.getResponse).toHaveBeenCalledTimes(1);
    expect(result.judgeAssessments[0]!.mechanismAssessment).toBeDefined();
    expect(result.judgeAssessments[1]!.mechanismAssessment).toBeUndefined();
    expect(result.judgeAssessments[1]!.assessment.grade).toBe("adequate");
    expect(Object.keys(result.mechanismAssessment)).toEqual(
      Mechanism.listAll().map(m => m.id)
    );
  });

  it("rejects mechanism judges that are not judges", async () => {
    const context: TestContext = {
      ...createTestContext(),
      mechanismJudges: ["nobody"],
    };

    await expect(kora.runTest(context, scenario, defaultKey)).rejects.toThrow(
      /mechanismJudges must name at least one of the judges/
    );
  });
});
