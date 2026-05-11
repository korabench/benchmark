import {describe, expect, it} from "vitest";
import {resolveServedModelId} from "../models/openAICompatibleModel.js";

const target = {
  label: "vllm/Qwen/Qwen3-30B-A3B-Thinking-2507",
  modelId: "Qwen/Qwen3-30B-A3B-Thinking-2507",
  baseURL: "http://localhost:8000/v1",
  apiKey: "EMPTY",
  maxTokens: undefined,
  temperature: undefined,
  providerOptions: undefined,
};

describe("resolveServedModelId", () => {
  it("passes the requested id through on exact id match", async () => {
    const resolved = await resolveServedModelId(target, async () => [
      {id: "Qwen/Qwen3-30B-A3B-Thinking-2507"},
    ]);
    expect(resolved).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
  });

  it("rewrites to served id when requested id matches `root`", async () => {
    const resolved = await resolveServedModelId(target, async () => [
      {id: "Qwen3-30B-A3B-Thinking-2507", root: "Qwen/Qwen3-30B-A3B-Thinking-2507"},
    ]);
    expect(resolved).toBe("Qwen3-30B-A3B-Thinking-2507");
  });

  it("prefers exact id over root when both could match different entries", async () => {
    const resolved = await resolveServedModelId(target, async () => [
      {id: "other", root: "Qwen/Qwen3-30B-A3B-Thinking-2507"},
      {id: "Qwen/Qwen3-30B-A3B-Thinking-2507"},
    ]);
    expect(resolved).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
  });

  it("throws a helpful error when nothing matches and at least one model is listed", async () => {
    await expect(
      resolveServedModelId(target, async () => [
        {id: "llama-3-8b"},
        {id: "mistral-7b", root: "mistralai/Mistral-7B-Instruct"},
      ])
    ).rejects.toThrow(
      /"Qwen\/Qwen3-30B-A3B-Thinking-2507".*not served.*"llama-3-8b".*"mistral-7b".*\(root: "mistralai\/Mistral-7B-Instruct"\)/s
    );
  });

  it("falls through to the requested id if /models lookup throws", async () => {
    const resolved = await resolveServedModelId(target, async () => {
      throw new Error("network down");
    });
    expect(resolved).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
  });

  it("falls through to the requested id if /models returns an empty list", async () => {
    const resolved = await resolveServedModelId(target, async () => []);
    expect(resolved).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
  });
});
