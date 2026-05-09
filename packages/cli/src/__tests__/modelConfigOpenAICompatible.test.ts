import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
  isOpenAICompatibleConfig,
  loadModelRegistry,
  resolveModelConfig,
} from "../models/modelConfig.js";

function writeRegistry(content: unknown): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `models-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(tmpFile, JSON.stringify(content));
  return tmpFile;
}

describe("openai-compatible model config", () => {
  let tmpFile: string | undefined;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
    // loadModelRegistry is memoized by path, so unique paths above prevent
    // cache collisions between tests.
  });

  it("accepts a fully specified entry", () => {
    tmpFile = writeRegistry({
      "vllm-qwen": {
        provider: "openai-compatible",
        model: "Qwen/Qwen3-30B-A3B-Thinking-2507",
        baseURL: "http://localhost:8000/v1",
        apiKeyEnv: "VLLM_API_KEY",
      },
    });
    const config = resolveModelConfig(tmpFile, "vllm-qwen");
    expect(isOpenAICompatibleConfig(config)).toBe(true);
    if (isOpenAICompatibleConfig(config)) {
      expect(config.model).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
      expect(config.baseURL).toBe("http://localhost:8000/v1");
      expect(config.apiKeyEnv).toBe("VLLM_API_KEY");
    }
  });

  it("rejects when neither baseURL nor baseURLEnv is set", () => {
    tmpFile = writeRegistry({
      bad: {
        provider: "openai-compatible",
        model: "x",
        apiKeyEnv: "K",
      },
    });
    expect(() => loadModelRegistry(tmpFile!)).toThrow(
      /baseURL.*baseURLEnv/
    );
  });

  it("rejects when both baseURL and baseURLEnv are set", () => {
    tmpFile = writeRegistry({
      bad: {
        provider: "openai-compatible",
        model: "x",
        baseURL: "http://a",
        baseURLEnv: "X",
        apiKeyEnv: "K",
      },
    });
    expect(() => loadModelRegistry(tmpFile!)).toThrow(
      /baseURL.*baseURLEnv/
    );
  });

  it("rejects when neither apiKey nor apiKeyEnv is set", () => {
    tmpFile = writeRegistry({
      bad: {
        provider: "openai-compatible",
        model: "x",
        baseURL: "http://a",
      },
    });
    expect(() => loadModelRegistry(tmpFile!)).toThrow(/apiKey.*apiKeyEnv/);
  });

  it("still parses gateway entries unchanged", () => {
    tmpFile = writeRegistry({
      "gpt-5.2:high": {
        model: "openai/gpt-5.2",
        maxTokens: 26000,
      },
    });
    const config = resolveModelConfig(tmpFile, "gpt-5.2:high");
    expect(isOpenAICompatibleConfig(config)).toBe(false);
    expect(config.model).toBe("openai/gpt-5.2");
  });
});
