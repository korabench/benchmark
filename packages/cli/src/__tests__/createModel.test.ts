import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createModel} from "../models/createModel.js";

function writeRegistry(content: unknown): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `models-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(tmpFile, JSON.stringify(content));
  return tmpFile;
}

describe("createModel dispatcher", () => {
  let tmpFile: string | undefined;
  const originalBaseURL = process.env.VLLM_BASE_URL;
  const originalApiKey = process.env.VLLM_API_KEY;

  beforeEach(() => {
    process.env.VLLM_BASE_URL = "http://localhost:8000/v1";
    process.env.VLLM_API_KEY = "EMPTY";
  });

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
    if (originalBaseURL === undefined) delete process.env.VLLM_BASE_URL;
    else process.env.VLLM_BASE_URL = originalBaseURL;
    if (originalApiKey === undefined) delete process.env.VLLM_API_KEY;
    else process.env.VLLM_API_KEY = originalApiKey;
  });

  it("routes a registered openai-compatible entry to the openai-compatible builder", () => {
    tmpFile = writeRegistry({
      "vllm-named": {
        provider: "openai-compatible",
        model: "Qwen/Qwen3-30B-A3B-Thinking-2507",
        baseURL: "http://localhost:8000/v1",
        apiKeyEnv: "VLLM_API_KEY",
      },
    });
    const model = createModel(tmpFile, "vllm-named");
    expect(typeof model.getTextResponse).toBe("function");
    expect(typeof model.getStructuredResponse).toBe("function");
  });

  it("routes a registered gateway entry to the gateway builder", () => {
    tmpFile = writeRegistry({
      "gpt-5.2:high": {
        model: "openai/gpt-5.2",
        maxTokens: 26000,
      },
    });
    const model = createModel(tmpFile, "gpt-5.2:high");
    expect(typeof model.getTextResponse).toBe("function");
    expect(typeof model.getStructuredResponse).toBe("function");
  });

  it("parses a `<prefix>/<model>` slug when the slug is not in the registry", () => {
    tmpFile = writeRegistry({});
    const model = createModel(tmpFile, "vllm/Qwen/Qwen3-30B-A3B-Thinking-2507");
    expect(typeof model.getTextResponse).toBe("function");
    expect(typeof model.getStructuredResponse).toBe("function");
  });

  it("throws the registry's `Unknown model` error when slug has no entry and no known prefix", () => {
    tmpFile = writeRegistry({});
    expect(() => createModel(tmpFile!, "definitely-not-a-real-slug")).toThrow(
      /Unknown model "definitely-not-a-real-slug"/
    );
  });

  it("throws on a slash-bearing slug whose prefix is not a known provider", () => {
    tmpFile = writeRegistry({});
    expect(() => createModel(tmpFile!, "nonprovider/some-model")).toThrow(
      /Unknown model "nonprovider\/some-model"/
    );
  });
});
