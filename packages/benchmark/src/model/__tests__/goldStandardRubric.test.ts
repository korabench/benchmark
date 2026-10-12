import {describe, expect, it} from "vitest";
import {Packs} from "../../packs/packs.js";
import {CRITERION_IDS, GoldStandardRubric} from "../goldStandardRubric.js";
import {SituationTypes} from "../situationTypes.js";

//
// Helpers.
//

const listedGoldStandards = SituationTypes.bundled().flatMap(entry =>
  entry.goldStandards.map(gs => ({riskId: entry.riskId, ...gs}))
);

/** "1.2b" → "GS-1_2b-", the prefix of that gold standard's case ids. */
function casePrefix(id: string): string {
  return `GS-${id.replace(".", "_")}-`;
}

//
// Tests.
//

describe("GoldStandardRubric.bundled", () => {
  it("has one rubric per gold standard listed with the situation types", () => {
    const rubrics = GoldStandardRubric.bundled();

    expect(rubrics.map(r => r.id).sort()).toEqual(
      listedGoldStandards.map(gs => gs.id).sort()
    );
    listedGoldStandards.forEach(gs => {
      const rubric = GoldStandardRubric.find(gs.id);
      expect(rubric.riskId, gs.id).toBe(gs.riskId);
      expect(rubric.name, gs.id).toBe(gs.name);
    });
  });

  it("names only risks of the bundled taxonomy", () => {
    const riskIds = new Set(
      Packs.bundled().taxonomy.categories.flatMap(c => c.risks.map(r => r.id))
    );
    GoldStandardRubric.bundled().forEach(rubric =>
      expect(riskIds.has(rubric.riskId), rubric.id).toBe(true)
    );
  });

  it("lists the criteria C1 to C9 in order", () => {
    GoldStandardRubric.bundled().forEach(rubric =>
      expect(
        rubric.criteria.map(c => c.id),
        rubric.id
      ).toEqual([...CRITERION_IDS])
    );
  });

  it("keeps at least one confirmed veto per gold standard", () => {
    GoldStandardRubric.bundled().forEach(rubric =>
      expect(
        GoldStandardRubric.confirmedVetoes(rubric).length,
        rubric.id
      ).toBeGreaterThan(0)
    );
  });

  it("gives every calibration case a unique id of its gold standard", () => {
    GoldStandardRubric.bundled().forEach(rubric => {
      const ids = rubric.cases.map(c => c.id);
      expect(new Set(ids).size, rubric.id).toBe(ids.length);
      ids.forEach(id =>
        expect(id.startsWith(casePrefix(rubric.id))).toBe(true)
      );
    });
  });

  it("carries the 288 calibration cases of the September corpus", () => {
    const cases = GoldStandardRubric.bundled().flatMap(r => r.cases);
    expect(cases).toHaveLength(288);
  });
});

describe("GoldStandardRubric.forSeed", () => {
  it("returns the gold standard the seed names", () => {
    const rubric = GoldStandardRubric.forSeed({
      riskId: "self_harm_and_eating_disorders",
      goldStandardId: "1.2b",
    });

    expect(rubric.id).toBe("1.2b");
  });

  it("falls back to the risk's only gold standard", () => {
    const rubric = GoldStandardRubric.forSeed({
      riskId: "violence_and_physical_harm",
    });

    expect(rubric.id).toBe("1.1");
  });

  it("refuses an umbrella risk without a gold standard id", () => {
    expect(() =>
      GoldStandardRubric.forSeed({riskId: "self_harm_and_eating_disorders"})
    ).toThrow(/3 gold standards/);
  });

  it("refuses a gold standard of another risk", () => {
    expect(() =>
      GoldStandardRubric.forSeed({
        riskId: "violence_and_physical_harm",
        goldStandardId: "1.2b",
      })
    ).toThrow(/belongs to risk/);
  });

  it("refuses an unknown gold standard", () => {
    expect(() =>
      GoldStandardRubric.forSeed({
        riskId: "violence_and_physical_harm",
        goldStandardId: "9.9",
      })
    ).toThrow(/No gold standard rubric/);
  });
});
