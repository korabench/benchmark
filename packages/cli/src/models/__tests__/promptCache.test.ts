import * as v from "valibot";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createGatewayModelFromConfig} from "../gatewayModel.js";

const {generateText, generateObject} = vi.hoisted(() => ({
  generateText: vi.fn(),
  generateObject: vi.fn(),
}));
vi.mock("ai", () => ({
  gateway: (model: string) => model,
  generateText,
  generateObject,
  jsonSchema: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const outputType = v.strictObject({ok: v.boolean()});

const messages = [
  {role: "system" as const, content: "A long, shared judge rubric."},
  {role: "user" as const, content: "The conversation under review."},
];

function usage(inputTokens: number, cacheReadTokens: number) {
  return {inputTokens, inputTokenDetails: {cacheReadTokens}};
}

function modelFor(model: string) {
  return createGatewayModelFromConfig(
    {model, providerOptions: {openai: {reasoningEffort: "medium"}}},
    model,
    {retry: {maxRetries: 0}}
  );
}

describe("prompt caching", () => {
  it("routes OpenAI requests of one key to the same cache, kept 24 hours", async () => {
    generateObject.mockResolvedValue({
      object: {ok: true},
      response: {modelId: "openai/gpt-5.2"},
      usage: usage(1000, 0),
    });

    await modelFor("openai/gpt-5.2").getStructuredResponse({
      messages,
      outputType,
      promptCacheKey: "kora-judge-1.1",
    });

    expect(generateObject.mock.calls[0]![0].providerOptions).toEqual({
      openai: {
        reasoningEffort: "medium",
        promptCacheKey: "kora-judge-1.1",
        promptCacheRetention: "24h",
      },
    });
  });

  it("sends OpenAI requests without a key as configured", async () => {
    generateObject.mockResolvedValue({
      object: {ok: true},
      response: {modelId: "openai/gpt-5.2"},
      usage: usage(1000, 0),
    });

    await modelFor("openai/gpt-5.2").getStructuredResponse({
      messages,
      outputType,
    });

    expect(generateObject.mock.calls[0]![0].providerOptions).toEqual({
      openai: {reasoningEffort: "medium"},
    });
  });

  it("marks the Anthropic system prompt as a cacheable prefix", async () => {
    generateText.mockResolvedValue({
      text: '{"ok": true}',
      response: {modelId: "anthropic/claude-opus-4.5"},
      usage: usage(1000, 0),
    });

    await modelFor("anthropic/claude-opus-4.5").getStructuredResponse({
      messages,
      outputType,
      promptCacheKey: "kora-judge-1.1",
    });

    const [system, user] = generateText.mock.calls[0]![0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("A long, shared judge rubric.");
    expect(system.providerOptions).toEqual({
      anthropic: {cacheControl: {type: "ephemeral"}},
    });
    expect(user).toEqual(messages[1]);
  });

  it("adds up input tokens and cache reads across calls", async () => {
    generateObject
      .mockResolvedValueOnce({
        object: {ok: true},
        response: {modelId: "openai/gpt-5.2"},
        usage: usage(1000, 0),
      })
      .mockResolvedValueOnce({
        object: {ok: true},
        response: {modelId: "openai/gpt-5.2"},
        usage: usage(1000, 900),
      });
    const model = modelFor("openai/gpt-5.2");

    await model.getStructuredResponse({messages, outputType});
    await model.getStructuredResponse({messages, outputType});

    expect(model.usage).toEqual({inputTokens: 2000, cachedInputTokens: 900});
  });
});
