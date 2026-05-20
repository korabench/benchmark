import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
  getOpenAICompatibleProvider,
  parseProviderSlug,
  resolveProviderConnection,
} from "../models/openAICompatibleProviders.js";

describe("parseProviderSlug", () => {
  it("parses vllm slug with simple model id", () => {
    const parsed = parseProviderSlug("vllm/Qwen3-30B");
    expect(parsed).toBeDefined();
    expect(parsed!.provider.prefix).toBe("vllm");
    expect(parsed!.modelId).toBe("Qwen3-30B");
  });

  it("preserves HuggingFace-style namespace in model id", () => {
    const parsed = parseProviderSlug("vllm/Qwen/Qwen3-30B-A3B-Thinking-2507");
    expect(parsed).toBeDefined();
    expect(parsed!.provider.prefix).toBe("vllm");
    expect(parsed!.modelId).toBe("Qwen/Qwen3-30B-A3B-Thinking-2507");
  });

  it("returns undefined for slug with no slash", () => {
    expect(parseProviderSlug("gpt-5.2:medium:limited")).toBeUndefined();
  });

  it("returns undefined for slug with unknown prefix", () => {
    expect(parseProviderSlug("nonprovider/some-model")).toBeUndefined();
  });

  it("resolves the openai prefix to api.openai.com by default", () => {
    const parsed = parseProviderSlug("openai/gpt-5-nano");
    expect(parsed).toBeDefined();
    expect(parsed!.modelId).toBe("gpt-5-nano");
    expect(parsed!.provider.defaultBaseURL).toBe("https://api.openai.com/v1");
    expect(parsed!.provider.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(parsed!.provider.supportsStructuredOutputs).toBe(true);
  });

  it("returns undefined for trailing-slash slug", () => {
    expect(parseProviderSlug("vllm/")).toBeUndefined();
  });

  it("returns undefined for leading-slash slug", () => {
    expect(parseProviderSlug("/Qwen3-30B")).toBeUndefined();
  });

  it("marks vllm as supporting structured outputs (json_schema response_format)", () => {
    const parsed = parseProviderSlug("vllm/whatever");
    expect(parsed!.provider.supportsStructuredOutputs).toBe(true);
  });
});

describe("resolveProviderConnection", () => {
  const provider = getOpenAICompatibleProvider("vllm")!;
  const originalBaseURL = process.env.VLLM_BASE_URL;
  const originalApiKey = process.env.VLLM_API_KEY;

  beforeEach(() => {
    delete process.env.VLLM_BASE_URL;
    delete process.env.VLLM_API_KEY;
  });

  afterEach(() => {
    if (originalBaseURL === undefined) delete process.env.VLLM_BASE_URL;
    else process.env.VLLM_BASE_URL = originalBaseURL;
    if (originalApiKey === undefined) delete process.env.VLLM_API_KEY;
    else process.env.VLLM_API_KEY = originalApiKey;
  });

  it("throws if VLLM_BASE_URL is not set (no default URL)", () => {
    expect(() => resolveProviderConnection(provider)).toThrow(/VLLM_BASE_URL/);
  });

  it("returns the env baseURL with trailing slashes trimmed", () => {
    process.env.VLLM_BASE_URL = "http://localhost:8000/v1//";
    process.env.VLLM_API_KEY = "secret-token";
    const conn = resolveProviderConnection(provider);
    expect(conn.baseURL).toBe("http://localhost:8000/v1");
    expect(conn.apiKey).toBe("secret-token");
  });

  it('falls back to "EMPTY" when API key is not set (vllm marks key optional)', () => {
    process.env.VLLM_BASE_URL = "http://localhost:8000/v1";
    const conn = resolveProviderConnection(provider);
    expect(conn.apiKey).toBe("EMPTY");
  });
});
