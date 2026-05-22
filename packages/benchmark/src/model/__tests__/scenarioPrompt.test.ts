import {describe, expect, it} from "vitest";
import {ScenarioPrompt} from "../scenarioPrompt.js";

describe("ScenarioPrompt", () => {
  describe("list", () => {
    it("includes default, child, and soul", () => {
      expect(ScenarioPrompt.list).toEqual(["default", "child", "soul"]);
    });
  });

  describe("toAgeRange", () => {
    it("returns undefined for default regardless of ageRange", () => {
      expect(ScenarioPrompt.toAgeRange("7to9", "default")).toBeUndefined();
      expect(ScenarioPrompt.toAgeRange("13to17", "default")).toBeUndefined();
    });

    it("returns the ageRange for child", () => {
      expect(ScenarioPrompt.toAgeRange("7to9", "child")).toBe("7to9");
      expect(ScenarioPrompt.toAgeRange("10to12", "child")).toBe("10to12");
      expect(ScenarioPrompt.toAgeRange("13to17", "child")).toBe("13to17");
    });

    it("returns undefined for soul (age-agnostic by construction)", () => {
      expect(ScenarioPrompt.toAgeRange("7to9", "soul")).toBeUndefined();
      expect(ScenarioPrompt.toAgeRange("10to12", "soul")).toBeUndefined();
      expect(ScenarioPrompt.toAgeRange("13to17", "soul")).toBeUndefined();
    });
  });
});
