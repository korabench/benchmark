import {afterEach, describe, expect, it} from "vitest";
import {Packs} from "../../packs/packs.js";
import {Mechanism} from "../mechanism.js";

//
// These assert the *bundled* pack, not a global invariant: a custom behavior
// set may legitimately have any number of behaviors with any codes.
//

afterEach(() => Packs.reset());

describe("Mechanism.listAll", () => {
  it("returns the 7 v2 conversation mechanisms of the bundled pack", () => {
    expect(Mechanism.listAll()).toHaveLength(7);
  });

  it("has unique ids", () => {
    const ids = Mechanism.listAll().map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique codes", () => {
    const codes = Mechanism.listAll().map(Mechanism.codeOf);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers the full M1–M7 range", () => {
    const codes = new Set(Mechanism.listAll().map(Mechanism.codeOf));
    expect(codes).toEqual(new Set(["M1", "M2", "M3", "M4", "M5", "M6", "M7"]));
  });

  it("every mechanism has a non-empty assessmentPrompt", () => {
    for (const m of Mechanism.listAll()) {
      expect(m.assessmentPrompt.length).toBeGreaterThan(0);
      expect(m.assessmentPrompt).toContain("DEFINITION");
      expect(m.assessmentPrompt).toContain("GRADING RUBRIC");
    }
  });

  it("keeps the precondition out of the assessmentPrompt body", () => {
    for (const m of Mechanism.listAll()) {
      expect(m.assessmentPrompt).not.toContain("PRECONDITION:");
    }
  });

  it("gates exactly M3, M5, M6 and M7 behind a precondition", () => {
    const gated = Mechanism.listAll()
      .filter(Mechanism.hasPrecondition)
      .map(Mechanism.codeOf);
    expect(new Set(gated)).toEqual(new Set(["M3", "M5", "M6", "M7"]));
  });

  it("every mechanism is at the conversation level", () => {
    for (const m of Mechanism.listAll()) {
      expect(m.level).toBe("conversation");
    }
  });

  it("resolves against the active pack, not the bundled one", () => {
    const behaviors = {
      id: "test",
      version: "1",
      behaviors: [
        {
          id: "only",
          name: "Only",
          level: "conversation" as const,
          assessmentPrompt: "DEFINITION: …",
        },
      ],
    };

    Packs.run({behaviors}, () => {
      expect(Mechanism.listAll().map(m => m.id)).toEqual(["only"]);
    });
    expect(Mechanism.listAll()).toHaveLength(7);
  });
});

describe("Mechanism.find", () => {
  it("returns the mechanism matching an id", () => {
    expect(Mechanism.codeOf(Mechanism.find("anthropomorphism"))).toBe("M6");
    expect(Mechanism.codeOf(Mechanism.find("sycophancy"))).toBe("M1");
  });

  it("throws for an unknown id", () => {
    expect(() => Mechanism.find("does_not_exist")).toThrow(
      "Mechanism not found"
    );
  });
});
