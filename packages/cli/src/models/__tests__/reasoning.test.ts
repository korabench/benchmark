import {afterEach, describe, expect, it, vi} from "vitest";
import {createFallbackModel} from "../fallbackModel.js";
import {
  createGatewayModelFromConfig,
  withVisibleReasoning,
} from "../gatewayModel.js";
import {Model} from "../model.js";

const {generateText} = vi.hoisted(() => ({generateText: vi.fn()}));
vi.mock("ai", () => ({
  gateway: (model: string) => model,
  generateText,
  generateObject: vi.fn(),
  jsonSchema: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const request = {messages: [{role: "user" as const, content: "Hi"}]};

function textResult(reasoningText: string | undefined) {
  return {
    text: "Answer",
    reasoningText,
    finishReason: "stop",
    response: {modelId: "anthropic/claude-sonnet-5.5"},
    usage: {
      inputTokens: 10,
      inputTokenDetails: {cacheReadTokens: 0},
      outputTokenDetails: {reasoningTokens: 30},
    },
  };
}

describe("withVisibleReasoning", () => {
  it("asks OpenAI for a reasoning summary", () => {
    expect(
      withVisibleReasoning("openai/gpt-5.5", {
        openai: {reasoningEffort: "low"},
      })
    ).toEqual({openai: {reasoningEffort: "low", reasoningSummary: "auto"}});
  });

  it("asks Anthropic for summarized thinking only where thinking is on", () => {
    expect(
      withVisibleReasoning("anthropic/claude-opus-5.5", {
        anthropic: {thinking: {type: "adaptive"}, effort: "high"},
      })
    ).toEqual({
      anthropic: {
        thinking: {type: "adaptive", display: "summarized"},
        effort: "high",
      },
    });
    expect(
      withVisibleReasoning("anthropic/claude-opus-4.8", undefined)
    ).toBeUndefined();
  });

  it("spells out the adaptive thinking Claude Fable runs by default", () => {
    expect(
      withVisibleReasoning("anthropic/claude-fable-5.1", undefined)
    ).toEqual({
      anthropic: {thinking: {type: "adaptive", display: "summarized"}},
    });
  });

  it("asks Gemini for its thoughts unless the thinking budget is zero", () => {
    expect(
      withVisibleReasoning("google/gemini-2.5-pro", {
        google: {
          thinkingConfig: {thinkingBudget: 8000, includeThoughts: false},
        },
      })
    ).toEqual({
      google: {thinkingConfig: {thinkingBudget: 8000, includeThoughts: true}},
    });
    const off = {
      google: {thinkingConfig: {thinkingBudget: 0, includeThoughts: false}},
    };
    expect(withVisibleReasoning("google/gemini-2.5-flash", off)).toBe(off);
    expect(
      withVisibleReasoning("google/gemma-4-31b-it", undefined)
    ).toBeUndefined();
  });

  it("leaves providers that return reasoning unasked alone", () => {
    const options = {deepseek: {thinking: {type: "enabled"}}};
    expect(withVisibleReasoning("deepseek/deepseek-v4-pro", options)).toBe(
      options
    );
  });
});

describe("gateway model reasoning", () => {
  const model = createGatewayModelFromConfig(
    {
      model: "anthropic/claude-sonnet-5.5",
      providerOptions: {anthropic: {thinking: {type: "adaptive"}}},
    },
    "sonnet",
    {retry: {maxRetries: 0}}
  );

  it("returns the reasoning and asks for it only on the reasoning call", async () => {
    generateText.mockResolvedValue(textResult("Thinking it over."));

    expect(await model.getTextResponseWithReasoning!(request)).toEqual({
      text: "Answer",
      reasoning: "Thinking it over.",
      reasoningTokens: 30,
    });
    expect(generateText.mock.calls[0]![0].providerOptions).toEqual({
      anthropic: {thinking: {type: "adaptive", display: "summarized"}},
    });

    expect(await model.getTextResponse(request)).toBe("Answer");
    expect(generateText.mock.calls[1]![0].providerOptions).toEqual({
      anthropic: {thinking: {type: "adaptive"}},
    });
  });

  it("reports no reasoning text when the provider returns none", async () => {
    generateText.mockResolvedValue(textResult(""));
    const response = await model.getTextResponseWithReasoning!(request);
    expect(response.reasoning).toBeUndefined();
  });
});

describe("fallback model reasoning", () => {
  it("forwards the reasoning call, or falls back to the plain answer", async () => {
    const plain: Model = {
      getTextResponse: vi.fn(async () => "Plain"),
      getStructuredResponse: vi.fn(),
    };
    const failing: Model = {
      getTextResponse: vi.fn(),
      getTextResponseWithReasoning: vi.fn(async () => {
        throw new Error("down");
      }),
      getStructuredResponse: vi.fn(),
    };
    const chain = createFallbackModel([
      {label: "a", model: failing},
      {label: "b", model: plain},
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await chain.getTextResponseWithReasoning!(request)).toEqual({
      text: "Plain",
    });
    expect(failing.getTextResponseWithReasoning).toHaveBeenCalledOnce();
  });
});
