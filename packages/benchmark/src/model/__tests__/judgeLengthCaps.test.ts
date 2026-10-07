import * as v from "valibot";
import {afterEach, describe, expect, it} from "vitest";
import {makeTaxonomy} from "../../packs/__tests__/fixtures.js";
import {Packs} from "../../packs/packs.js";
import {JudgeLengthCaps} from "../judgeLengthCaps.js";
import {Mechanism} from "../mechanism.js";
import {MechanismAssessment} from "../mechanismAssessment.js";
import {TestAssessment} from "../testAssessment.js";

//
// The judge schemas follow the taxonomy a run is pinned to: up to version 2
// the rationale caps are the provider's to enforce, as they were when those
// runs were graded; from version 3 they are a wide post-parse net only. The
// JSON form sent to providers is checked in cli/src/models/__tests__.
//

afterEach(() => Packs.reset());

function underLegacyTaxonomy<T>(fn: () => T): T {
  return Packs.run({taxonomy: Packs.legacyTaxonomy()}, fn);
}

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

describe("JudgeLengthCaps.forActiveTaxonomy", () => {
  it("is the current contract on the bundled taxonomy", () => {
    expect(Packs.current().taxonomy.version).toBe("3");
    expect(JudgeLengthCaps.forActiveTaxonomy()).toBe(
      JudgeLengthCaps.currentContract
    );
  });

  it("is the legacy contract on taxonomies before version 3", () => {
    ["1", "1.1", "2"].forEach(version => {
      Packs.run({taxonomy: makeTaxonomy({version})}, () => {
        expect(JudgeLengthCaps.forActiveTaxonomy()).toBe(
          JudgeLengthCaps.legacyContract
        );
      });
    });
    expect(underLegacyTaxonomy(JudgeLengthCaps.forActiveTaxonomy)).toBe(
      JudgeLengthCaps.legacyContract
    );
  });

  it("treats an unparseable version as current", () => {
    Packs.run({taxonomy: makeTaxonomy({version: "next"})}, () => {
      expect(JudgeLengthCaps.forActiveTaxonomy()).toBe(
        JudgeLengthCaps.currentContract
      );
    });
  });
});

describe("TestAssessment.io", () => {
  it("caps reasons at 3000 and leaves the provider uncapped, by default", () => {
    const schema = TestAssessment.io;
    expect(JudgeLengthCaps.enforcedByProvider(schema)).toBe(false);
    expect(v.safeParse(schema, assessment(3000)).success).toBe(true);
    expect(v.safeParse(schema, assessment(3001)).success).toBe(false);
  });

  it("keeps the provider-enforced 1500 cap under a legacy taxonomy", () => {
    underLegacyTaxonomy(() => {
      const schema = TestAssessment.io;
      expect(JudgeLengthCaps.enforcedByProvider(schema)).toBe(true);
      expect(v.safeParse(schema, assessment(1500)).success).toBe(true);
      expect(v.safeParse(schema, assessment(1501)).success).toBe(false);
      expect(v.safeParse(schema, assessment(199)).success).toBe(false);
    });
  });

  it("hands back one schema object per contract", () => {
    const current = TestAssessment.io;
    expect(TestAssessment.io).toBe(current);
    const legacy = underLegacyTaxonomy(() => TestAssessment.io);
    expect(legacy).not.toBe(current);
    expect(underLegacyTaxonomy(() => TestAssessment.io)).toBe(legacy);
  });
});

describe("MechanismAssessment.io", () => {
  it("caps every criterion's reasons by the active contract", () => {
    expect(JudgeLengthCaps.enforcedByProvider(MechanismAssessment.io)).toBe(
      false
    );
    expect(
      v.safeParse(MechanismAssessment.io, mechanismAssessment(1000)).success
    ).toBe(true);
    expect(
      v.safeParse(MechanismAssessment.io, mechanismAssessment(1001)).success
    ).toBe(false);

    underLegacyTaxonomy(() => {
      const schema = MechanismAssessment.io;
      expect(JudgeLengthCaps.enforcedByProvider(schema)).toBe(true);
      expect(v.safeParse(schema, mechanismAssessment(500)).success).toBe(true);
      expect(v.safeParse(schema, mechanismAssessment(501)).success).toBe(false);
    });
  });

  it("caches per behavior set and per contract", () => {
    const current = MechanismAssessment.io;
    expect(MechanismAssessment.io).toBe(current);
    const legacy = underLegacyTaxonomy(() => MechanismAssessment.io);
    expect(legacy).not.toBe(current);
    expect(underLegacyTaxonomy(() => MechanismAssessment.io)).toBe(legacy);
  });
});
