import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {Motivation} from "../../model/motivation.js";
import {MotivationUseLikelihood} from "../../model/motivationUseLikelihood.js";
import {populationDistributionPresets} from "../../model/populationDistributionPresets.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {SeedUse} from "../../model/scenarioSeed.js";
import {
  allocateSeedAssignments,
  SeedAssignment,
} from "../allocateSeedAssignments.js";
import {allocateUniform} from "../allocateUniform.js";
import {pairUsesWithMotivations} from "../pairUsesWithMotivations.js";
import {makeRng} from "../rng.js";

const likelihood = MotivationUseLikelihood.bundled();
const motivations = Motivation.listAll();
const names = motivations.map(m => m.name);

/** Motivation names cycled over `total` seeds, as the allocator assigns them. */
function cycle(total: number): string[] {
  return Array.from({length: total}, (_, i) => names[i % names.length]!);
}

describe("bundled motivation × use likelihood", () => {
  it("only names bundled motivations", () => {
    expect(Object.keys(likelihood).filter(n => !names.includes(n))).toEqual([]);
  });

  it("scores unlisted pairings as neutral", () => {
    expect(
      MotivationUseLikelihood.score(
        likelihood,
        "No such motivation",
        "creative"
      )
    ).toBe(MotivationUseLikelihood.neutralScore);
  });
});

describe("pairUsesWithMotivations", () => {
  it("returns a permutation of the allocated uses", () => {
    const uses = allocateUniform(SeedUse.list, 75, makeRng(1));
    const paired = pairUsesWithMotivations(
      cycle(75),
      uses,
      likelihood,
      makeRng(2)
    );
    expect(R.countBy(paired, u => u)).toEqual(R.countBy(uses, u => u));
  });

  it("leaves no incompatible pairing when one can be avoided", () => {
    const incompatible = R.range(0, 30).flatMap(seed => {
      const seedNames = cycle(75);
      const paired = pairUsesWithMotivations(
        seedNames,
        allocateUniform(SeedUse.list, 75, makeRng(seed)),
        likelihood,
        makeRng(seed + 100)
      );
      return paired.filter(
        (use, i) =>
          MotivationUseLikelihood.score(likelihood, seedNames[i]!, use) === 0
      );
    });
    expect(incompatible).toEqual([]);
  });

  it("raises the mean likelihood of the pairings", () => {
    const seedNames = cycle(75);
    const meanScore = (uses: readonly SeedUse[]) =>
      R.sum(
        uses.map((use, i) =>
          MotivationUseLikelihood.score(likelihood, seedNames[i]!, use)
        )
      ) / uses.length;
    const uses = allocateUniform(SeedUse.list, 75, makeRng(5));
    const paired = pairUsesWithMotivations(
      seedNames,
      uses,
      likelihood,
      makeRng(6)
    );
    expect(meanScore(paired)).toBeGreaterThan(meanScore(uses));
  });

  it("keeps the counts when an incompatible pairing is unavoidable", () => {
    const paired = pairUsesWithMotivations(
      ["Social Belonging / Validation", "Social Belonging / Validation"],
      ["homework", "learning"],
      likelihood,
      makeRng(0)
    );
    expect([...paired].sort()).toEqual(["homework", "learning"]);
  });

  it("is reproducible given the same seed", () => {
    const run = () =>
      pairUsesWithMotivations(
        cycle(40),
        allocateUniform(SeedUse.list, 40, makeRng(3)),
        likelihood,
        makeRng(4)
      );
    expect(run()).toEqual(run());
  });

  it("rejects mismatched lengths", () => {
    expect(() =>
      pairUsesWithMotivations(["a"], [], likelihood, makeRng(0))
    ).toThrow(/1 motivations for 0 uses/);
  });
});

describe("allocateSeedAssignments with use likelihood", () => {
  const risk = RiskCategory.listAll()[0]!.risks[0]!;
  const distribution = populationDistributionPresets["us-census-2023"]!;
  const allocate = (useLikelihood?: MotivationUseLikelihood) =>
    allocateSeedAssignments({
      risk,
      distribution,
      motivations,
      total: 75,
      rng: makeRng(11),
      useLikelihood,
    });

  it("changes only which seed gets which use", () => {
    const strip = (a: SeedAssignment) => R.omit(a, ["use"]);
    const before = allocate();
    const after = allocate(likelihood);

    expect(after.map(strip)).toEqual(before.map(strip));
    expect(R.countBy(after, a => a.use)).toEqual(R.countBy(before, a => a.use));
    expect(after.map(a => a.use)).not.toEqual(before.map(a => a.use));
  });

  it("pairs no motivation with an incompatible use", () => {
    expect(
      allocate(likelihood).filter(
        a =>
          MotivationUseLikelihood.score(
            likelihood,
            a.motivation.name,
            a.use
          ) === 0
      )
    ).toEqual([]);
  });
});
