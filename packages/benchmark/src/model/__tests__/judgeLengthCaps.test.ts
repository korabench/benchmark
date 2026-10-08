import * as v from "valibot";
import {afterEach, describe, expect, it} from "vitest";
import {Packs} from "../../packs/packs.js";
import {JudgeLengthCaps} from "../judgeLengthCaps.js";
import {Mechanism} from "../mechanism.js";
import {MechanismAssessment} from "../mechanismAssessment.js";
import {TestAssessment} from "../testAssessment.js";

//
// The judge schemas cap their rationales as a wide post-parse net, and carry
// the prose mark a multi-edition harness reads to strip the caps before a
// provider sees them. The JSON form sent to providers is checked in
// cli/src/models/__tests__.
//

afterEach(() => Packs.reset());

function assessment(reasonsLength: number) {
  return {grade: "adequate", reasons: "x".repeat(reasonsLength)};
}

function mechanismAssessment(reasonsLength: number) {
  return Object.fromEntries(
    Mechanism.listAll().map(m => [
      m.id,
      {
        grade: "adequate",
        occurrenceCount: 0,
        reasons: "x".repeat(reasonsLength),
        notTriggered: false,
      },
    ])
  );
}

describe("JudgeLengthCaps.isProse", () => {
  it("reads the mark, and only that value of it", () => {
    const schema = v.string();
    expect(JudgeLengthCaps.isProse(schema)).toBe(false);
    expect(JudgeLengthCaps.isProse(JudgeLengthCaps.markProse(schema))).toBe(
      true
    );
    expect(
      JudgeLengthCaps.isProse(
        v.pipe(schema, v.metadata({lengthCaps: "provider"}))
      )
    ).toBe(false);
  });
});

describe("TestAssessment.io", () => {
  it("caps reasons between 200 and 3000, marked as prose", () => {
    const schema = TestAssessment.io;
    expect(JudgeLengthCaps.isProse(schema)).toBe(true);
    expect(v.safeParse(schema, assessment(3000)).success).toBe(true);
    expect(v.safeParse(schema, assessment(3001)).success).toBe(false);
    expect(v.safeParse(schema, assessment(199)).success).toBe(false);
  });
});

describe("MechanismAssessment.io", () => {
  it("caps every criterion's reasons at 1000, marked as prose", () => {
    const schema = MechanismAssessment.io;
    expect(JudgeLengthCaps.isProse(schema)).toBe(true);
    expect(v.safeParse(schema, mechanismAssessment(1000)).success).toBe(true);
    expect(v.safeParse(schema, mechanismAssessment(1001)).success).toBe(false);
  });

  it("caches per behavior set", () => {
    expect(MechanismAssessment.io).toBe(MechanismAssessment.io);
  });
});
