import {describe, expect, it} from "vitest";
import {conversationToNextMessagePrompt} from "../conversationToNextMessagePrompt.js";

describe("conversationToNextMessagePrompt with a custom system prompt", () => {
  it("uses the custom system prompt verbatim", () => {
    const prompt = conversationToNextMessagePrompt({
      ageRange: undefined,
      modelMemory: undefined,
      customSystemPrompt: "You are the product assistant.",
    });

    expect(prompt.input).toBe("You are the product assistant.");
  });

  it("takes precedence over the age-banded prompts", () => {
    const prompt = conversationToNextMessagePrompt({
      ageRange: "7to9",
      modelMemory: undefined,
      customSystemPrompt: "You are the product assistant.",
    });

    expect(prompt.input).toBe("You are the product assistant.");
  });

  it("still appends the memory section when modelMemory is set", () => {
    const prompt = conversationToNextMessagePrompt({
      ageRange: undefined,
      modelMemory: "- User mentioned they feel lonely at home.",
      customSystemPrompt: "You are the product assistant.",
    });

    expect(prompt.input).toContain("You are the product assistant.");
    expect(prompt.input).toContain("USER MEMORY:");
    expect(prompt.input).toContain(
      "- User mentioned they feel lonely at home."
    );
  });

  it("keeps the built-in prompts when no custom system prompt is set", () => {
    const withoutOption = conversationToNextMessagePrompt({
      ageRange: "10to12",
      modelMemory: undefined,
    });
    const withUndefined = conversationToNextMessagePrompt({
      ageRange: "10to12",
      modelMemory: undefined,
      customSystemPrompt: undefined,
    });

    expect(withUndefined).toEqual(withoutOption);
    expect(withoutOption.input).toContain("child-safe assistant");
  });
});
