import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {Motivation} from "../../model/motivation.js";
import {MotivationUseMask} from "../../model/motivationUseMask.js";
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

const mask = MotivationUseMask.bundled();
const motivations = Motivation.listAll();
const names = motivations.map(m => m.name);

/** Motivation names cycled over `total` seeds, as the allocator assigns them. */
function cycle(total: number): string[] {
  return Array.from({length: total}, (_, i) => names[i % names.length]!);
}

/** The pairings of `uses` with `seedNames` that the mask forbids. */
function forbidden(seedNames: readonly string[], uses: readonly SeedUse[]) {
  return uses
    .map((use, i) => [seedNames[i]!, use] as const)
    .filter(([name, use]) => !MotivationUseMask.allowed(mask, name, use));
}

describe("bundled motivation × use mask", () => {
  it("covers every bundled motivation and every use", () => {
    expect(Object.keys(mask).sort()).toEqual([...names].sort());
    Object.values(mask).forEach(uses =>
      expect(Object.keys(uses).sort()).toEqual([...SeedUse.list].sort())
    );
  });

  it("forbids exactly the three V3.0 pairings", () => {
    const pairs = names.flatMap(name =>
      SeedUse.list
        .filter(use => !MotivationUseMask.allowed(mask, name, use))
        .map(use => `${name} × ${use}`)
    );
    expect(pairs.sort()).toEqual([
      "Efficiency / Shortcut Seeking × companionship",
      "Efficiency / Shortcut Seeking × entertainment",
      "Identity Exploration × homework",
    ]);
  });

  it("allows unlisted pairings", () => {
    expect(
      MotivationUseMask.allowed(mask, "No such motivation", "creative")
    ).toBe(true);
  });
});

describe("pairUsesWithMotivations", () => {
  it("returns a permutation of the allocated uses", () => {
    const uses = allocateUniform(SeedUse.list, 75, makeRng(1));
    const paired = pairUsesWithMotivations(cycle(75), uses, mask, makeRng(2));
    expect(R.countBy(paired, u => u)).toEqual(R.countBy(uses, u => u));
  });

  it("leaves no forbidden pairing when one can be avoided", () => {
    const remaining = R.range(0, 30).flatMap(seed => {
      const seedNames = cycle(75);
      return forbidden(
        seedNames,
        pairUsesWithMotivations(
          seedNames,
          allocateUniform(SeedUse.list, 75, makeRng(seed)),
          mask,
          makeRng(seed + 100)
        )
      );
    });
    expect(remaining).toEqual([]);
  });

  it("keeps the counts when a forbidden pairing is unavoidable", () => {
    const paired = pairUsesWithMotivations(
      ["Efficiency / Shortcut Seeking", "Efficiency / Shortcut Seeking"],
      ["entertainment", "companionship"],
      mask,
      makeRng(0)
    );
    expect([...paired].sort()).toEqual(["companionship", "entertainment"]);
  });

  it("is reproducible given the same seed", () => {
    const run = () =>
      pairUsesWithMotivations(
        cycle(40),
        allocateUniform(SeedUse.list, 40, makeRng(3)),
        mask,
        makeRng(4)
      );
    expect(run()).toEqual(run());
  });

  it("rejects mismatched lengths", () => {
    expect(() => pairUsesWithMotivations(["a"], [], mask, makeRng(0))).toThrow(
      /1 motivations for 0 uses/
    );
  });
});

describe("allocateSeedAssignments with the use mask", () => {
  const risk = RiskCategory.listAll()[0]!.risks[0]!;
  const distribution = populationDistributionPresets["us-census-2023"]!;
  const allocate = (useMask?: MotivationUseMask) =>
    allocateSeedAssignments({
      risk,
      distribution,
      motivations,
      total: 75,
      rng: makeRng(11),
      useMask,
    });

  it("changes only which seed gets which use", () => {
    const strip = (a: SeedAssignment) => R.omit(a, ["use"]);
    const before = allocate();
    const after = allocate(mask);

    expect(after.map(strip)).toEqual(before.map(strip));
    expect(R.countBy(after, a => a.use)).toEqual(R.countBy(before, a => a.use));
    expect(after.map(a => a.use)).not.toEqual(before.map(a => a.use));
  });

  it("pairs no motivation with a forbidden use", () => {
    const after = allocate(mask);
    expect(
      forbidden(
        after.map(a => a.motivation.name),
        after.map(a => a.use)
      )
    ).toEqual([]);
  });
});
