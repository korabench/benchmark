import {Scenario} from "@korabench/benchmark";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createCustomHttpModel} from "../customHttpModel.js";
import {createCustomModel} from "../customModel.js";

const URL = "http://localhost:8000/v1/chat/completions";
const SLUG = `custom-http:${URL}`;
// Scenario isn't read by custom-http; a stub keeps the tests focused.
const stubScenario = {} as unknown as Scenario;
const noRetry = {maxRetries: 0, onRetry: () => {}};
const hi = {messages: [{role: "user" as const, content: "hi"}]};

function chatResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({choices: [{message: {content}}]}), {
    status,
    headers: {"content-type": "application/json"},
  });
}

describe("custom-http", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("routes custom-http slugs through createCustomModel", async () => {
    vi.stubEnv("CUSTOM_HTTP_MODEL", "qwen3-8b");
    vi.stubEnv("CUSTOM_HTTP_API_KEY", "sk-test");
    fetchMock.mockResolvedValue(chatResponse("hello"));

    const model = await createCustomModel(SLUG, stubScenario);
    await expect(model.getTextResponse(hi)).resolves.toBe("hello");

    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(URL);
    expect(JSON.parse(init.body).model).toBe("qwen3-8b");
    expect(init.headers).toMatchObject({authorization: "Bearer sk-test"});
  });

  it("throws when the slug carries no URL", () => {
    expect(() => createCustomHttpModel({modelSlug: "custom-http:"})).toThrow(
      /missing a URL/
    );
  });

  it("POSTs the OpenAI chat body shape", async () => {
    fetchMock.mockResolvedValue(chatResponse("hello"));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await model.getTextResponse({
      messages: [
        {role: "system", content: "be helpful"},
        {role: "user", content: "hi"},
      ],
      temperature: 0.5,
      maxTokens: 100,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      model: SLUG,
      messages: [
        {role: "system", content: "be helpful"},
        {role: "user", content: "hi"},
      ],
      temperature: 0.5,
      max_tokens: 100,
    });
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("omits unset sampling parameters", async () => {
    fetchMock.mockResolvedValue(chatResponse("ok"));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await model.getTextResponse(hi);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it.each([
    ["a full <think> block", "<think>\nThe child asks...\n</think>\n\nHi!"],
    // Templates that open the block in the prompt (DeepSeek-R1 distills, QwQ).
    ["only the closing tag", "The child asks...\n</think>\n\nHi!"],
  ])("strips reasoning given %s", async (_, content) => {
    fetchMock.mockResolvedValue(chatResponse(content));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await expect(model.getTextResponse(hi)).resolves.toBe("Hi!");
  });

  it("passes plain answers through untouched", async () => {
    fetchMock.mockResolvedValue(chatResponse("  Hi!\n"));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await expect(model.getTextResponse(hi)).resolves.toBe("  Hi!\n");
  });

  it("fails an unterminated <think> block instead of grading it", async () => {
    fetchMock.mockResolvedValue(chatResponse("<think>\nThe child asks, so"));
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 3, onRetry: () => {}},
    });

    await expect(model.getTextResponse(hi)).rejects.toThrow(
      /unterminated <think> block/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503])("retries on %i", async status => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response("busy", {status}))
      .mockResolvedValueOnce(chatResponse("ok"));
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 1, onRetry: () => {}},
    });

    const pending = model.getTextResponse(hi);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // OpenAI-compatible servers tag these "invalid_request_error", which the
  // message heuristic in retry.ts would otherwise treat as transient.
  it.each([
    [400, "maximum context length exceeded"],
    [401, "Invalid API Key"],
    [404, "The model `qwen3` does not exist"],
  ])("does not retry a %i", async (status, message) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({error: {message, type: "invalid_request_error"}}),
        {status}
      )
    );
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 3, onRetry: () => {}},
    });

    await expect(model.getTextResponse(hi)).rejects.toThrow(
      `custom-http ${status}: `
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hints at CUSTOM_HTTP_MODEL when the slug is rejected as a model", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"invalid model name"}}', {status: 400})
    );
    const unset = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});
    const set = createCustomHttpModel({
      modelSlug: SLUG,
      model: "qwen3-8b",
      retry: noRetry,
    });

    await expect(unset.getTextResponse(hi)).rejects.toThrow(
      /set CUSTOM_HTTP_MODEL/
    );
    await expect(set.getTextResponse(hi)).rejects.not.toThrow(
      /CUSTOM_HTTP_MODEL/
    );
  });

  it("retries network failures and names the cause", async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        }),
      })
    );
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 2, onRetry: () => {}},
    });

    const assertion = expect(model.getTextResponse(hi)).rejects.toThrow(
      "fetch failed (ECONNRESET)"
    );
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the response lacks choices[0].message.content", async () => {
    fetchMock.mockResolvedValue(chatResponse(null));
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 3, onRetry: () => {}},
    });

    await expect(model.getTextResponse(hi)).rejects.toThrow(
      /missing choices\[0\]\.message\.content/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects structured requests", async () => {
    const model = createCustomHttpModel({modelSlug: SLUG});

    await expect(
      model.getStructuredResponse({...hi, outputType: {} as never})
    ).rejects.toThrow(/do not support structured output/);
  });
});

describe("createCustomModel — unknown custom slug", () => {
  it("points at custom-http in the error", async () => {
    const model = await createCustomModel("custom-unknown", stubScenario);
    await expect(model.getTextResponse(hi)).rejects.toThrow(
      /custom-http:<url>/
    );
  });
});
