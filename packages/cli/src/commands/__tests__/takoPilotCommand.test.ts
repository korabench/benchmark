import {describe, expect, it} from "vitest";
import {
  advanceComposerPollState,
  dedupeOcrLines,
  selectTakoAssistantForPrompt,
  selectTakoAssistantMessage,
  summarizeTakoPilot,
  TakoPilotResult,
} from "../takoPilotCommand.js";

describe("advanceComposerPollState", () => {
  it("requires activity before counting consecutive idle frames", () => {
    const initial = {responseStarted: false, idlePolls: 0};
    const stillIdle = advanceComposerPollState(initial, 0.01);
    const active = advanceComposerPollState(stillIdle, 0.3);
    const firstIdle = advanceComposerPollState(active, 0.02);
    const secondIdle = advanceComposerPollState(firstIdle, 0.01);

    expect(stillIdle).toEqual({responseStarted: false, idlePolls: 0});
    expect(active).toEqual({responseStarted: true, idlePolls: 0});
    expect(firstIdle).toEqual({responseStarted: true, idlePolls: 1});
    expect(secondIdle).toEqual({responseStarted: true, idlePolls: 2});
  });

  it("resets the idle count when activity resumes", () => {
    expect(
      advanceComposerPollState({responseStarted: true, idlePolls: 1}, 0.2)
    ).toEqual({responseStarted: true, idlePolls: 0});
  });
});

function result(
  total: number,
  status: "completed" | "failed"
): TakoPilotResult {
  return {
    schemaVersion: 1,
    runId: "run",
    scenarioId: `${status}-${total}`,
    shortTitle: "title",
    riskId: "risk",
    prompt: "prompt",
    status,
    assistantMessage: status === "completed" ? "answer" : undefined,
    startedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: "2026-07-09T00:00:01.000Z",
    timingsMs: {reset: 1, textEntry: 1, response: 1, total},
    polls: status === "completed" ? 3 : 0,
    extraction:
      status === "completed"
        ? {
            method: "accessibility",
            reviewRequired: false,
            accessibilityChars: 6,
            outputChars: 6,
          }
        : undefined,
    error: status === "failed" ? "failed" : undefined,
  };
}

describe("summarizeTakoPilot", () => {
  it("summarizes successful timings without including failures", () => {
    expect(
      summarizeTakoPilot([
        result(1_000, "completed"),
        result(2_000, "completed"),
        result(9_000, "failed"),
        result(3_000, "completed"),
      ])
    ).toEqual({
      attempted: 4,
      completed: 3,
      failed: 1,
      meanMs: 2_000,
      medianMs: 2_000,
      p95Ms: 3_000,
      extractionMethods: {
        accessibility: 3,
        clipboard: 0,
        ocr: 0,
        unknown: 0,
      },
      reviewRequired: 0,
    });
  });
});

describe("selectTakoAssistantMessage", () => {
  it("ignores search status rows and selects the substantive response", () => {
    expect(
      selectTakoAssistantMessage(
        [
          {role: "assistant", text: "old answer"},
          {role: "user", text: "new question"},
          {role: "assistant", text: "Searched 10 sources"},
          {
            role: "assistant",
            text: "Use the primary source as evidence of historical bias, not as fact.",
          },
        ],
        1
      )
    ).toBe(
      "Use the primary source as evidence of historical bias, not as fact."
    );
  });
});

describe("selectTakoAssistantForPrompt", () => {
  it("selects only an answer that follows the exact current prompt", () => {
    const messages = [
      {role: "user" as const, text: "old prompt"},
      {role: "assistant" as const, text: "old response"},
      {role: "user" as const, text: "current prompt"},
      {role: "assistant" as const, text: "Searching sources"},
      {role: "assistant" as const, text: "current response"},
    ];

    expect(selectTakoAssistantForPrompt(messages, "current prompt")).toBe(
      "current response"
    );
    expect(selectTakoAssistantForPrompt(messages, "missing prompt")).toBe(
      undefined
    );
  });

  it("uses the last exact prompt when a transcript contains retries", () => {
    expect(
      selectTakoAssistantForPrompt(
        [
          {role: "user", text: "same prompt"},
          {role: "assistant", text: "stale response"},
          {role: "user", text: "same prompt"},
          {role: "assistant", text: "fresh response"},
        ],
        "same prompt"
      )
    ).toBe("fresh response");
  });

  it("accepts TikTok's collapsed long-prompt prefix", () => {
    const prompt =
      "This is a deliberately long prompt whose exact composer value was already verified before sending and whose bubble is collapsed by TikTok.";
    expect(
      selectTakoAssistantForPrompt(
        [
          {role: "user", text: `${prompt.slice(0, 90)}...`},
          {role: "assistant", text: "current response"},
        ],
        prompt
      )
    ).toBe("current response");
  });
});

describe("dedupeOcrLines", () => {
  it("removes repeated overlap while preserving page order", () => {
    expect(
      dedupeOcrLines([
        ["First paragraph", "Shared overlap"],
        ["Shared   overlap", "Final paragraph."],
      ])
    ).toBe("First paragraph Shared overlap Final paragraph.");
  });
});
