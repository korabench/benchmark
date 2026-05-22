import {describe, expect, it} from "vitest";
import {conversationToNextMessagePrompt} from "../conversationToNextMessagePrompt.js";

describe("conversationToNextMessagePrompt", () => {
  describe("default prompt (no ageRange)", () => {
    it("returns the generic assistant prompt", () => {
      const {input} = conversationToNextMessagePrompt({
        ageRange: undefined,
        modelMemory: undefined,
      });
      expect(input).toContain("highly capable, thoughtful, and precise");
    });

    it("appends USER MEMORY when modelMemory is set", () => {
      const {input} = conversationToNextMessagePrompt({
        ageRange: undefined,
        modelMemory: "User likes blue.",
      });
      expect(input).toContain("USER MEMORY:");
      expect(input).toContain("User likes blue.");
    });
  });

  describe("child prompt (ageRange set)", () => {
    it("returns the 7to9 child-safe prompt", () => {
      const {input} = conversationToNextMessagePrompt({
        ageRange: "7to9",
        modelMemory: undefined,
      });
      expect(input).toContain("aged 7–9");
    });

    it("returns the 13to17 teen prompt", () => {
      const {input} = conversationToNextMessagePrompt({
        ageRange: "13to17",
        modelMemory: undefined,
      });
      expect(input).toContain("aged 13–17");
    });
  });

  describe("soul prompt", () => {
    it("returns the soulBody verbatim", () => {
      const body = "You are the SOULFuzz target. Reply concisely.";
      const {input} = conversationToNextMessagePrompt({
        ageRange: undefined,
        modelMemory: undefined,
        prompt: "soul",
        soulBody: body,
      });
      expect(input).toBe(body);
    });

    it("does not auto-append modelMemory", () => {
      const body = "Soul body only.";
      const {input} = conversationToNextMessagePrompt({
        ageRange: undefined,
        modelMemory: "Should not appear.",
        prompt: "soul",
        soulBody: body,
      });
      expect(input).toBe(body);
      expect(input).not.toContain("USER MEMORY");
      expect(input).not.toContain("Should not appear.");
    });

    it("ignores ageRange when prompt=soul", () => {
      const body = "Soul body only.";
      const {input} = conversationToNextMessagePrompt({
        ageRange: "7to9",
        modelMemory: undefined,
        prompt: "soul",
        soulBody: body,
      });
      expect(input).toBe(body);
    });

    it("throws when soulBody is missing", () => {
      expect(() =>
        conversationToNextMessagePrompt({
          ageRange: undefined,
          modelMemory: undefined,
          prompt: "soul",
        })
      ).toThrow(/soulBody/);
    });
  });
});
