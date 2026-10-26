import {afterEach, describe, expect, it, vi} from "vitest";
import {createSpecModel} from "../../profiles/roleModels.js";

const spec = {
  name: "mimesis-9b",
  model: "modal/mimesis-9b",
  maxTokens: 4096,
  temperature: 1,
};
const request = {
  messages: [{role: "system" as const, content: "A fictional child profile"}],
};
function fixture(finish_reason = "stop") {
  vi.stubEnv("MIMESIS_BASE_URL", "https://example.test/v1");
  vi.stubEnv("MIMESIS_API_KEY", "dummy.token");
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({
      model: "mimesis-9b",
      choices: [
        {
          finish_reason,
          message: {content: "why?", reasoning: "PRIVATE_REASONING"},
        },
      ],
      usage: {prompt_tokens: 12},
    })
  );
  vi.stubGlobal("fetch", fetch);
  return {fetch, model: createSpecModel(spec)};
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CLI Modal child transport", () => {
  it("uses the configured proxy credentials and returns only visible output", async () => {
    const {fetch, model} = fixture();
    expect(fetch).not.toHaveBeenCalled();
    expect(await model.getTextResponse(request)).toBe("why?");
    expect(fetch.mock.calls[0]![0]).toBe(
      "https://example.test/v1/chat/completions"
    );
    expect(
      new Headers(fetch.mock.calls[0]![1].headers).get("authorization")
    ).toBe("Bearer dummy.token");
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({
      messages: request.messages,
      max_tokens: 4096,
      temperature: 1,
      top_p: 0.95,
    });
    expect([...model.served]).toEqual(["mimesis-9b"]);
    expect(model.usage.inputTokens).toBe(12);
  });
  it("fails a truncated first draft without content retries", async () => {
    const {fetch, model} = fixture("length");
    await expect(model.getTextResponse(request)).rejects.toThrow(/truncated/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries only explicit startup rejection", async () => {
    vi.useFakeTimers();
    const {fetch, model} = fixture();
    fetch.mockResolvedValueOnce(
      new Response("private startup detail", {status: 503})
    );
    const response = model.getTextResponse(request);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await response).toBe("why?");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not redirect credentials or echo transport error details", async () => {
    const {fetch, model} = fixture();
    fetch.mockRejectedValue(new Error("PRIVATE_HEADERS"));
    await expect(model.getTextResponse(request)).rejects.toThrow(
      "MIMESIS transport failed or timed out."
    );
    expect(fetch.mock.calls[0]![1].redirect).toBe("error");
  });
});
