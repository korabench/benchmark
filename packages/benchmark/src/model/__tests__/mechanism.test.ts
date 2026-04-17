import {describe, expect, it} from "vitest";
import {Mechanism} from "../mechanism.js";

describe("Mechanism.listAll", () => {
  const mechanisms = Mechanism.listAll();

  it("parses and returns the 7 v2 conversation mechanisms", () => {
    expect(mechanisms).toHaveLength(7);
  });

  it("has unique ids", () => {
    const ids = mechanisms.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique Excel ids", () => {
    const excelIds = mechanisms.map(m => m.excelId);
    expect(new Set(excelIds).size).toBe(excelIds.length);
  });

  it("covers the full M1–M7 range", () => {
    const excelIds = new Set(mechanisms.map(m => m.excelId));
    expect(excelIds).toEqual(
      new Set(["M1", "M2", "M3", "M4", "M5", "M6", "M7"])
    );
  });

  it("every mechanism has a non-empty criterionPrompt", () => {
    for (const m of mechanisms) {
      expect(m.criterionPrompt.length).toBeGreaterThan(0);
      expect(m.criterionPrompt).toContain("DEFINITION");
      expect(m.criterionPrompt).toContain("GRADE RUBRIC");
    }
  });

  it("every mechanism is at the conversation level", () => {
    for (const m of mechanisms) {
      expect(m.level).toBe("conversation");
    }
  });
});

describe("Mechanism.find", () => {
  it("returns the mechanism matching an id", () => {
    expect(Mechanism.find("anthropomorphism").excelId).toBe("M6");
    expect(Mechanism.find("sycophancy").excelId).toBe("M1");
  });

  it("throws for an unknown id", () => {
    expect(() => Mechanism.find("does_not_exist")).toThrow(
      "Mechanism not found"
    );
  });
});
