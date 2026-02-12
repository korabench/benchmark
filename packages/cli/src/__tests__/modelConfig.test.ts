import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {resolveModelConfig} from "../modelConfig.js";

const testModels = {
  "gpt-5.2:high": {
    model: "openai/gpt-5.2",
    maxTokens: 26000,
    providerOptions: {
      openai: {
        reasoningEffort: "high",
      },
    },
  },
  "deepseek-v3": {
    model: "deepseek/deepseek-chat",
    maxTokens: 26000,
    temperature: 0.5,
  },
};

describe("resolveModelConfig", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `models-test-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(testModels));
  });

  afterEach(() => {
    fs.unlinkSync(tmpFile);
  });

  it("resolves a model with providerOptions", () => {
    expect(resolveModelConfig(tmpFile, "gpt-5.2:high")).toEqual({
      model: "openai/gpt-5.2",
      maxTokens: 26000,
      providerOptions: {
        openai: {
          reasoningEffort: "high",
        },
      },
    });
  });

  it("resolves a model with temperature", () => {
    expect(resolveModelConfig(tmpFile, "deepseek-v3")).toEqual({
      model: "deepseek/deepseek-chat",
      maxTokens: 26000,
      temperature: 0.5,
    });
  });

  it("throws for unknown model", () => {
    expect(() => resolveModelConfig(tmpFile, "nonexistent")).toThrow(
      'Unknown model "nonexistent"'
    );
  });
});
