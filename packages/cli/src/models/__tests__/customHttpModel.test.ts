import {Scenario} from "@korabench/benchmark";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createCustomHttpModel} from "../customHttpModel.js";
import {createCustomModel} from "../customModel.js";

const URL = "http://localhost:8000/v1/chat/completions";
const SLUG = `custom-http:${URL}`;
// Scenario isn't read by custom-http; a stub keeps the tests focused.
const stubScenario = {} as unknown as Scenario;
const noRetry = {maxRetries: 0, onRetry: () => {}};

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
    await expect(
      model.getTextResponse({messages: [{role: "user", content: "hi"}]})
    ).resolves.toBe("hello");

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

    await model.getTextResponse({messages: [{role: "user", content: "hi"}]});

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("strips a leading <think> block from reasoning models", async () => {
    fetchMock.mockResolvedValue(
      chatResponse("<think>\nThe child asks...\n</think>\n\nHi there!")
    );
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await expect(
      model.getTextResponse({messages: [{role: "user", content: "hi"}]})
    ).resolves.toBe("Hi there!");
  });

  it("retries on 429 and returns the eventual answer", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", {status: 429}))
      .mockResolvedValueOnce(chatResponse("ok"));
    const model = createCustomHttpModel({
      modelSlug: SLUG,
      retry: {maxRetries: 1, onRetry: () => {}},
    });

    const pending = model.getTextResponse({
      messages: [{role: "user", content: "hi"}],
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with status + body excerpt on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", {status: 400}));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await expect(
      model.getTextResponse({messages: [{role: "user", content: "hi"}]})
    ).rejects.toThrow(/custom-http 400: bad request/);
  });

  it("throws when the response lacks choices[0].message.content", async () => {
    fetchMock.mockResolvedValue(chatResponse(null));
    const model = createCustomHttpModel({modelSlug: SLUG, retry: noRetry});

    await expect(
      model.getTextResponse({messages: [{role: "user", content: "hi"}]})
    ).rejects.toThrow(/missing choices\[0\]\.message\.content/);
  });

  it("rejects structured requests", async () => {
    const model = createCustomHttpModel({modelSlug: SLUG});

    await expect(
      model.getStructuredResponse({
        messages: [{role: "user", content: "hi"}],
        outputType: {} as never,
      })
    ).rejects.toThrow(/do not support structured output/);
  });
});

describe("createCustomModel — unknown custom slug", () => {
  it("points at custom-http in the error", async () => {
    const model = await createCustomModel("custom-unknown", stubScenario);
    await expect(
      model.getTextResponse({messages: [{role: "user", content: "hi"}]})
    ).rejects.toThrow(/custom-http:<url>/);
  });
});
