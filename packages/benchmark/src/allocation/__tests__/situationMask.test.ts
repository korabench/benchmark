import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {Motivation} from "../../model/motivation.js";
import {MotivationUseMask} from "../../model/motivationUseMask.js";
import {PopulationDistribution} from "../../model/populationDistribution.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {SituationMask} from "../../model/situationMask.js";
import {SituationTypes} from "../../model/situationTypes.js";
import {
  allocateSeedAssignments,
  SeedAssignment,
} from "../allocateSeedAssignments.js";
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
function allocateCorpus(situationMask?: SituationMask): Allocated[] {
  const rng = makeRng(42);
  return RiskCategory.listAll()
    .flatMap(category => category.risks)
    .flatMap(risk =>
      allocateSeedAssignments({
        risk,
        distribution: PopulationDistribution.default(),
        motivations: Motivation.listAll(),
        total: 75,
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

  it("keeps the counts per use and per risk signal type in every risk", () => {
    expect(countsPerRisk(masked, a => a.use)).toEqual(
      countsPerRisk(without, a => a.use)
    );
    expect(countsPerRisk(masked, a => a.riskSignalType)).toEqual(
      countsPerRisk(without, a => a.riskSignalType)
    );
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
