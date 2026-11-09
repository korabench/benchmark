import {ModelRequest, ModelResponse} from "@korabench/core";
import * as v from "valibot";
import {describe, expect, it, vi} from "vitest";
import {JudgeModel, JudgeRequest, TestContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {AssistantTurn} from "../model/assistantTurn.js";
import {ChildTurn} from "../model/childTurn.js";
import {InvalidTurnError} from "../model/invalidTurnError.js";
import {Mechanism} from "../model/mechanism.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {TestAssessment} from "../model/testAssessment.js";
import {makeStamp} from "../stamp/__tests__/fixtures.js";
import {Stamp} from "../stamp/stamp.js";
import {
  createJudgeOutput,
  createScenario,
  createScenarioSeed,
} from "./fixtures.js";

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
  // A 3-turn risk (1.3): the turn and message counts below are written for it.
  const scenario = createScenario({
    seed: createScenarioSeed({riskId: "regulated_and_illegal_activities"}),
  });
  const keys = kora.mapScenarioToKeys(scenario, ScenarioPrompt.list);
  const defaultKey = keys.find(k => k.endsWith(":default"))!;
  const childKey = keys.find(k => k.endsWith(":child"))!;

  it("opens with the stored first message, uses an explicit native child pipeline for every later turn and resumes from the saved visible messages", async () => {
    const context = createTestContext();
    const histories: number[] = [];
    context.getChildResponse = vi.fn(async ({messages}) => {
      histories.push(messages.length);
      return {output: `Native child turn ${messages.length / 2}`};
    });
    const first = await kora.runTest(context, scenario, defaultKey);
    expect(histories).toEqual([2, 4]);
    expect(first.messages[0]!.content).toBe(scenario.firstUserMessage);
    expect(first.messages[2]!.content).toBe("Native child turn 1");
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

  it("records the native child's outcome for each turn it generated, and none without one", async () => {
    const context = createTestContext();
    context.getChildResponse = vi.fn(async ({messages}) => ({
      output: `Native child turn ${messages.length / 2}`,
      outcome: {
        status: "unchanged" as const,
        issueCount: 0,
        editCount: 0,
        endMarkerRedraws: 0,
        leaving: messages.length === 4,
      },
    }));
    const result = await kora.runTest(context, scenario, defaultKey);
    expect(result.childTurns).toEqual([
      expect.objectContaining({turn: 1, leaving: false}),
      expect.objectContaining({turn: 2, leaving: true}),
    ]);
    const resumed = await kora.runTest(
      context,
      scenario,
      defaultKey,
      result.messages.slice(0, 4)
    );
    expect(resumed.childTurns?.map(t => t.turn)).toEqual([2]);
    const plain = await kora.runTest(createTestContext(), scenario, defaultKey);
    expect("childTurns" in plain).toBe(false);
    expect(v.parse(v.array(ChildTurn.io), result.childTurns)).toEqual(
      result.childTurns
    );
  });

  it("runs the conversation to its end but judges it only up to the child's leaving turn", async () => {
    const leavingAt = (turn: number) => {
      const context = createTestContext();
      context.getChildResponse = vi.fn(async ({messages}) => ({
        output: `Native child turn ${messages.length / 2}`,
        outcome: {
          status: "unchanged" as const,
          issueCount: 0,
          editCount: 0,
          endMarkerRedraws: 0,
          leaving: messages.length / 2 >= turn,
        },
      }));
      return context;
    };
    const judged = (context: ReturnType<typeof createTestContext>) =>
      context.judgeModel.getResponse.mock.calls
        .map(([request]) => (request as JudgeRequest<unknown>).messages.at(-1))
        .map(message => String(message?.content));

    const context = leavingAt(1);
    const result = await kora.runTest(context, scenario, defaultKey);
    expect(result.messages).toHaveLength(6);
    const prompts = judged(context);
    expect(prompts).toHaveLength(2);
    prompts.forEach(prompt => {
      expect(prompt).toContain("Native child turn 1");
      expect(prompt).not.toContain("Native child turn 2");
    });

    // A leave recorded before a resume still cuts what the judges read.
    const resumedContext = leavingAt(3);
    await kora.runTest(
      resumedContext,
      scenario,
      defaultKey,
      result.messages.slice(0, 4),
      result.childTurns?.filter(t => t.turn < 2)
    );
    judged(resumedContext).forEach(prompt =>
      expect(prompt).not.toContain("Native child turn 2")
    );

    // A child who never leaves is judged on the whole conversation.
    const staying = leavingAt(99);
    await kora.runTest(staying, scenario, defaultKey);
    judged(staying).forEach(prompt =>
      expect(prompt).toContain("Native child turn 2")
    );
  });

  it("records the child's outcomes and the target's reasoning side by side", async () => {
    const context = createTestContext();
    context.getChildResponse = vi.fn(async ({messages}) => ({
      output: `Native child turn ${messages.length / 2}`,
      outcome: {
        status: "unchanged" as const,
        issueCount: 0,
        editCount: 0,
        endMarkerRedraws: 0,
        leaving: false,
      },
    }));
    context.getAssistantResponse = vi.fn(async () => ({
      output: "Answer",
      reasoning: "Thinking.",
      reasoningTokens: 5,
    }));
    const result = await kora.runTest(context, scenario, defaultKey);
    expect(result.childTurns?.map(t => t.turn)).toEqual([1, 2]);
    expect(result.assistantTurns?.map(t => t.turn)).toEqual([0, 1, 2]);
    expect(v.parse(v.array(AssistantTurn.io), result.assistantTurns)).toEqual(
      result.assistantTurns
    );
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
    expect(safetyCall?.promptCacheKey).toBe("kora-judge-1.3");
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

  it("records the tested model's reasoning per turn and keeps it from the judges", async () => {
    const context = createTestContext();
    let turn = 0;
    context.getAssistantResponse = vi.fn(async () => {
      const t = turn++;
      return t === 1
        ? {output: `Answer ${t}`}
        : {
            output: `Answer ${t}`,
            reasoning: `SECRET-REASONING-${t}`,
            reasoningTokens: 40 + t,
          };
    });

    const result = await kora.runTest(context, scenario, defaultKey);

    expect(result.assistantTurns).toEqual([
      {turn: 0, reasoning: "SECRET-REASONING-0", reasoningTokens: 40},
      {turn: 2, reasoning: "SECRET-REASONING-2", reasoningTokens: 42},
    ]);
    expect(result.messages[2 * 2 + 1]!.content).toBe("Answer 2");
    const judgeRequests = JSON.stringify(
      context.judgeModel.getResponse.mock.calls
    );
    expect(judgeRequests).not.toContain("SECRET-REASONING");
  });

  it("records token-only reasoning and omits assistantTurns without any", async () => {
    const tokensOnly = createTestContext();
    tokensOnly.getAssistantResponse = vi.fn(async () => ({
      output: "Answer",
      reasoning: "",
      reasoningTokens: 12,
    }));
    const withTokens = await kora.runTest(tokensOnly, scenario, defaultKey);
    expect(withTokens.assistantTurns?.[0]).toEqual({
      turn: 0,
      reasoning: null,
      reasoningTokens: 12,
    });

    const zero = createTestContext();
    zero.getAssistantResponse = vi.fn(async () => ({
      output: "Answer",
      reasoningTokens: 0,
    }));
    const none = await kora.runTest(zero, scenario, defaultKey);
    expect("assistantTurns" in none).toBe(false);
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
