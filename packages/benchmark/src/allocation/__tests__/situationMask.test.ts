import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {Motivation} from "../../model/motivation.js";
import {MotivationUseMask} from "../../model/motivationUseMask.js";
import {PopulationDistribution} from "../../model/populationDistribution.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {RiskSignalType} from "../../model/scenarioSeed.js";
import {SituationMask} from "../../model/situationMask.js";
import {SituationTypes} from "../../model/situationTypes.js";
import {
  allocateSeedAssignments,
  SeedAssignment,
} from "../allocateSeedAssignments.js";
import {reassignForbidden} from "../reassignForbidden.js";
import {makeRng} from "../rng.js";
import {swapAwayForbidden} from "../swapAwayForbidden.js";

const mask = SituationMask.bundled();
const useMask = MotivationUseMask.bundled();
const situationTypes = SituationTypes.bundled();

interface Allocated {
  riskId: string;
  assignment: SeedAssignment;
}

/** The full corpus at 75 seeds per risk, with or without the situation mask. */
function allocateCorpus(
  situationMask?: SituationMask,
  total = 75,
  randomSeed = 42
): Allocated[] {
  const rng = makeRng(randomSeed);
  return RiskCategory.listAll()
    .flatMap(category => category.risks)
    .flatMap(risk =>
      allocateSeedAssignments({
        risk,
        distribution: PopulationDistribution.default(),
        motivations: Motivation.listAll(),
        total,
        rng,
        useMask,
        situationTypes,
        situationMask,
      }).map(assignment => ({riskId: risk.id, assignment}))
    );
}

function situationKey({riskId, assignment: a}: Allocated): string {
  return `${riskId}|${a.situation?.goldStandardId}|${a.situation?.situationType}|${a.ageRange}`;
}

function forbiddenBySituation(corpus: readonly Allocated[]): Allocated[] {
  return corpus.filter(({riskId, assignment: a}) => {
    const type = a.situation!.situationType;
    return (
      !SituationMask.allowsUse(mask, riskId, type, a.use) ||
      !SituationMask.allowsRiskSignalType(mask, riskId, type, a.riskSignalType)
    );
  });
}

function forbiddenByMotivation(corpus: readonly Allocated[]): Allocated[] {
  return corpus.filter(
    ({assignment: a}) =>
      !MotivationUseMask.allowed(useMask, a.motivation.name, a.use)
  );
}

function countsPerRisk(
  corpus: readonly Allocated[],
  valueOf: (assignment: SeedAssignment) => string
): Record<string, number> {
  return R.countBy(corpus, c => `${c.riskId}|${valueOf(c.assignment)}`);
}

describe("swapAwayForbidden", () => {
  it("trades a forbidden value for one both seeds may hold", () => {
    // Seed 0 may not hold "a".
    const out = swapAwayForbidden(
      ["a", "b", "c"],
      (i, value) => !(i === 0 && value === "a")
    );
    expect(out).toEqual(["b", "a", "c"]);
  });

  it("skips a partner that could not hold the value either", () => {
    // Seeds 0 and 1 may not hold "a".
    const out = swapAwayForbidden(
      ["a", "b", "c"],
      (i, value) => !(i <= 1 && value === "a")
    );
    expect(out).toEqual(["c", "b", "a"]);
  });

  it("keeps the counts, and leaves a value no trade can move", () => {
    const values = ["a", "a", "b"];
    const out = swapAwayForbidden(values, (_, value) => value !== "a");
    expect(out).toEqual(values);
    expect(swapAwayForbidden(["a"], () => false)).toEqual(["a"]);
  });

  it("returns the input order when nothing is forbidden", () => {
    expect(swapAwayForbidden(["a", "b", "c"], () => true)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("reassignForbidden", () => {
  const candidates = ["a", "b", "c"];

  it("replaces a forbidden value with the allowed one the fewest seeds hold", () => {
    // No seed may hold "a"; "c" is held by fewer seeds than "b".
    const out = reassignForbidden(
      ["a", "b", "b", "c"],
      candidates,
      (_, value) => value !== "a"
    );
    expect(out).toEqual(["c", "b", "b", "c"]);
  });

  it("spreads several replacements over the allowed values", () => {
    const out = reassignForbidden(
      ["a", "a", "a", "a"],
      candidates,
      (_, value) => value !== "a"
    );
    expect(R.countBy(out, value => value)).toEqual({b: 2, c: 2});
  });

  it("only uses values the seed may hold", () => {
    // Seed 0 may hold "c" only, although "b" is held by fewer seeds.
    const out = reassignForbidden(
      ["a", "c", "c"],
      candidates,
      (i, value) => i !== 0 || value === "c"
    );
    expect(out).toEqual(["c", "c", "c"]);
  });

  it("returns the input when nothing is forbidden", () => {
    expect(reassignForbidden(["a", "b"], candidates, () => true)).toEqual([
      "a",
      "b",
    ]);
  });

  it("throws when a seed may hold none of the values", () => {
    expect(() => reassignForbidden(["a"], candidates, () => false)).toThrow(
      "may hold none"
    );
  });
});

describe("bundled situation mask", () => {
  const listed = situationTypes.flatMap(entry =>
    entry.goldStandards.flatMap(goldStandard =>
      SituationTypes.allocated(goldStandard).map(type => ({
        riskId: entry.riskId,
        name: type.name,
      }))
    )
  );

  it("only names situation types that receive seeds", () => {
    [...mask.use, ...mask.riskSignalType].forEach(rule =>
      expect(
        listed.some(
          type =>
            type.name === rule.situationType &&
            (rule.riskId === undefined || rule.riskId === type.riskId)
        ),
        `${rule.riskId ?? "any risk"} / ${rule.situationType}`
      ).toBe(true)
    );
  });

  it("leaves every situation type a risk signal type to hold", () => {
    listed.forEach(type =>
      expect(
        RiskSignalType.list.some(signal =>
          SituationMask.allowsRiskSignalType(
            mask,
            type.riskId,
            type.name,
            signal
          )
        ),
        `${type.riskId} / ${type.name}`
      ).toBe(true)
    );
  });

  it("forbids an ambiguous signal for a disclosure made outright, a direct one for a veiled type", () => {
    const allows = (situationType: string, signal: RiskSignalType) =>
      SituationMask.allowsRiskSignalType(
        mask,
        "any_risk",
        situationType,
        signal
      );
    ["Direct request", "Disclosure of abuse", "Distress disclosure"].forEach(
      type => {
        expect(allows(type, "ambiguous"), type).toBe(false);
        expect(allows(type, "direct"), type).toBe(true);
        expect(allows(type, "subtle"), type).toBe(true);
      }
    );
    [
      "Reframed request",
      "Indirect disclosure",
      "Inadvertent escalation",
    ].forEach(type => {
      expect(allows(type, "direct"), type).toBe(false);
      expect(allows(type, "ambiguous"), type).toBe(true);
    });
  });
});

describe("situation mask in the allocation (75 seeds per risk)", () => {
  const without = allocateCorpus();
  const masked = allocateCorpus(mask);

  it("leaves no forbidden pair, where the unmasked allocation had some", () => {
    expect(forbiddenBySituation(without).length).toBeGreaterThan(0);
    expect(forbiddenBySituation(masked)).toEqual([]);
  });

  it("does not move a single situation type", () => {
    expect(masked.map(situationKey)).toEqual(without.map(situationKey));
    // The 134 situation types of the gold standards that receive seeds.
    const types = (corpus: readonly Allocated[]) =>
      R.countBy(
        corpus,
        ({riskId, assignment: a}) =>
          `${riskId}|${a.situation!.goldStandardId}|${a.situation!.situationType}`
      );
    expect(Object.keys(types(masked))).toHaveLength(134);
    expect(types(masked)).toEqual(types(without));
  });

  it("leaves no forbidden pair at other sizes and random seeds", () => {
    [
      {total: 10, randomSeed: 1},
      {total: 60, randomSeed: 7},
      {total: 100, randomSeed: 3},
    ].forEach(({total, randomSeed}) =>
      expect(
        forbiddenBySituation(allocateCorpus(mask, total, randomSeed)),
        `total ${total}, random seed ${randomSeed}`
      ).toEqual([])
    );
  });

  it("keeps the counts per use in every risk", () => {
    expect(countsPerRisk(masked, a => a.use)).toEqual(
      countsPerRisk(without, a => a.use)
    );
  });

  it("takes seeds from a risk signal type only where too few seeds may hold it", () => {
    // A share is a risk, or one gold standard of an umbrella risk.
    const share = ({riskId, assignment: a}: Allocated) =>
      `${riskId}|${a.situation!.goldStandardId}`;
    const shares = R.groupBy(masked, share);
    const evenShares = R.groupBy(without, share);
    const lost: string[] = [];

    Object.entries(shares).forEach(([key, seeds]) => {
      RiskSignalType.list.forEach(signal => {
        const holds = (c: Allocated) => c.assignment.riskSignalType === signal;
        const allocated = evenShares[key]!.filter(holds).length;
        const kept = seeds.filter(holds).length;
        const room = seeds.filter(({riskId, assignment: a}) =>
          SituationMask.allowsRiskSignalType(
            mask,
            riskId,
            a.situation!.situationType,
            signal
          )
        ).length;
        expect(kept, `${key} ${signal}`).toBeGreaterThanOrEqual(
          Math.min(allocated, room)
        );
        if (kept < allocated) lost.push(`${key} ${signal}`);
      });
    });

    // Violence (1.1), regulated activities (1.3) and academic dishonesty (4.2)
    // have a single situation type that allows an ambiguous signal.
    expect(lost).toEqual([
      "violence_and_physical_harm|1.1 ambiguous",
      "regulated_and_illegal_activities|1.3 ambiguous",
      "academic_dishonesty_and_misuse|4.2 ambiguous",
    ]);
    expect(R.countBy(masked, c => c.assignment.riskSignalType)).toEqual({
      direct: 662,
      subtle: 661,
      ambiguous: 627,
    });
  });

  it("changes nothing but the use and the risk signal type of a seed", () => {
    const rest = ({assignment}: Allocated) =>
      R.omit(assignment, ["use", "riskSignalType"]);
    expect(masked.map(rest)).toEqual(without.map(rest));
  });

  it("creates no forbidden motivation × use pair", () => {
    expect(forbiddenByMotivation(masked).length).toBe(
      forbiddenByMotivation(without).length
    );
  });
});
