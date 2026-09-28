import {readFileSync} from "node:fs";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createGatewayModelFromConfig} from "../gatewayModel.js";

const {generateText} = vi.hoisted(() => ({generateText: vi.fn()}));
vi.mock("ai", () => ({
  gateway: (model: string) => model,
  generateText,
  generateObject: vi.fn(),
  jsonSchema: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const profile = JSON.parse(
  readFileSync(
    new URL("../../../../../profiles/kora.json", import.meta.url),
    "utf8"
  )
);
const roles = [
  profile.roles.expansionUser[0],
  profile.roles.user,
  profile.roles.continueUser,
];

describe("Gemma child profile", () => {
  it.each(roles)("uses the study settings for $name", async spec => {
    generateText.mockResolvedValue({
      text: "why?",
      finishReason: "stop",
      response: {modelId: spec.model},
    });
    const model = createGatewayModelFromConfig(spec, spec.name, {
      retry: {maxRetries: 0},
    });
    expect(
      await model.getTextResponse({
        messages: [{role: "user", content: "Go"}],
        maxTokens: 300,
      })
    ).toBe("why?");
    const request = generateText.mock.calls[0]![0];
    expect(request.model).toBe("google/gemma-4-31b-it");
    expect(request.maxOutputTokens).toBe(300);
    expect(request.temperature).toBeUndefined();
    expect(request.providerOptions).toBeUndefined();
    expect([...model.served]).toEqual(["google/gemma-4-31b-it"]);
  });

  it.each(["content-filter", "length", "error", "stop"])(
    "does not accept an empty/failed child turn (%s)",
    async finishReason => {
      generateText.mockResolvedValue({
        text: "",
        finishReason,
        response: {modelId: "google/gemma-4-31b-it"},
      });
      const model = createGatewayModelFromConfig(roles[0], "gemma", {
        retry: {maxRetries: 0},
      });
      await expect(
        model.getTextResponse({messages: [{role: "user", content: "Go"}]})
      ).rejects.toThrow();
    }
  );
});
