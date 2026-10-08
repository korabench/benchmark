import * as R from "remeda";
import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {
  createMinimalScenarioSeed,
  createScenario,
  createScenarioSeed,
} from "../../__tests__/fixtures.js";
import {RiskCategory} from "../riskCategory.js";
import {ModelScenarioLight, Scenario} from "../scenario.js";
import {
  ModelScenarioSeed,
  RefusalBehavior,
  RiskSignalType,
  ScenarioSeed,
  SeedMemory,
  SeedUse,
  seedUseDescriptions,
  seedUseScopes,
} from "../scenarioSeed.js";

const narrative = {
  shortTitle: "A short title",
  coreBehavior: "The child does something risky online.",
  context: "The child is browsing alone after school.",
  notes: "",
};

describe("use definitions", () => {
  it("define and scope every use, and point exclusions at a use of the list", () => {
    for (const use of SeedUse.list) {
      expect(seedUseDescriptions[use]).toMatch(/^The child /);
      const scope = seedUseScopes[use];
      expect(scope.includes.length).toBeGreaterThanOrEqual(5);
      expect(scope.excludes.length).toBeGreaterThanOrEqual(3);
      for (const exclusion of scope.excludes) {
        const pointer = exclusion.match(/\((\w+)\)$/)?.[1];
        if (pointer && pointer !== "a") {
          expect(SeedUse.list).toContain(pointer);
          expect(pointer).not.toBe(use);
        }
      }
    }
  });
});

describe("seed dimensions", () => {
  it("exposes the values of each code-assigned dimension", () => {
    expect(RiskSignalType.list).toEqual(["direct", "subtle", "ambiguous"]);
    expect(SeedUse.list).toEqual([
      "homework",
      "entertainment",
      "companionship",
      "health_advice",
      "creative",
      "learning",
    ]);
    expect(RefusalBehavior.list).toEqual(["insists", "drops", "works_around"]);
    expect(SeedMemory.list).toEqual(["none", "established"]);
  });
});

describe("ModelScenarioSeed (what the model writes)", () => {
  it("accepts the narrative fields alone", () => {
    expect(v.safeParse(ModelScenarioSeed.io, narrative).success).toBe(true);
  });

  it.each([
    ["childAge", 12],
    ["childGender", "girl"],
    ["childRaceEthnicity", "asian"],
    ["riskSignalType", "direct"],
    ["socialContext", "alone"],
    ["use", "homework"],
    ["relabeled", {riskSignalType: {from: "ambiguous"}}],
    ["refusalBehavior", "insists"],
    ["childCognitiveMaturity", "medium"],
    ["childEmotionalMaturity", "medium"],
  ])("rejects the dimension %s: the model chooses none", (key, value) => {
    expect(
      v.safeParse(ModelScenarioSeed.io, {...narrative, [key]: value}).success
    ).toBe(false);
  });
});

describe("ScenarioSeed (what is stored)", () => {
  it("accepts a seed carrying every assigned dimension", () => {
    const seed = createScenarioSeed({scenarioFlavorId: "b_gradual"});
    expect(v.safeParse(ScenarioSeed.io, seed).success).toBe(true);
  });

  it("accepts a seed without the optional dimensions", () => {
    const minimal = createMinimalScenarioSeed();
    expect(minimal.use).toBeUndefined();
    expect(v.safeParse(ScenarioSeed.io, minimal).success).toBe(true);
  });

  it("rejects the maturity levels V2 seeds carried", () => {
    expect(
      v.safeParse(ScenarioSeed.io, {
        ...createScenarioSeed(),
        childCognitiveMaturity: "medium",
      }).success
    ).toBe(false);
  });

  it("accepts a relabeled signal type, and only a known value as the assigned one", () => {
    const seed = createScenarioSeed({
      riskSignalType: "subtle",
      relabeled: {riskSignalType: {from: "ambiguous"}},
    });
    expect(v.safeParse(ScenarioSeed.io, seed).success).toBe(true);
    expect(
      v.safeParse(ScenarioSeed.io, {
        ...seed,
        relabeled: {
          riskSignalType: {from: "ambiguous"},
          use: {from: "learning"},
        },
      }).success
    ).toBe(true);
    expect(
      v.safeParse(ScenarioSeed.io, {
        ...seed,
        relabeled: {riskSignalType: {from: "loud"}},
      }).success
    ).toBe(false);
  });

  it("rejects values outside a dimension's picklist", () => {
    const bad = [
      {use: "shopping"},
      {refusalBehavior: "gives_up"},
      {memory: "partial"},
      {riskSignalType: "loud"},
      {socialContext: "crowd"},
    ];
    for (const override of bad) {
      expect(
        v.safeParse(ScenarioSeed.io, {...createScenarioSeed(), ...override})
          .success
      ).toBe(false);
    }
  });

  it("requires the dimensions every corpus carries", () => {
    const withoutSignal = R.omit(createScenarioSeed(), ["riskSignalType"]);
    const withoutAge = R.omit(createScenarioSeed(), ["childAge"]);
    expect(v.safeParse(ScenarioSeed.io, withoutSignal).success).toBe(false);
    expect(v.safeParse(ScenarioSeed.io, withoutAge).success).toBe(false);
  });
});

describe("ScenarioSeed.hasMemory", () => {
  const plainRisk = RiskCategory.findAnyRisk(
    "privacy_and_personal_data_protection"
  )!;
  const memoryRisk = RiskCategory.findAnyRisk("grooming_and_manipulation")!;

  it("lets the seed decide when it carries a memory", () => {
    expect(
      ScenarioSeed.hasMemory(
        createScenarioSeed({memory: "established"}),
        plainRisk
      )
    ).toBe(true);
    expect(
      ScenarioSeed.hasMemory(createScenarioSeed({memory: "none"}), memoryRisk)
    ).toBe(false);
  });

  it("falls back to the risk for seeds that predate the dimension", () => {
    expect(ScenarioSeed.hasMemory(createMinimalScenarioSeed(), plainRisk)).toBe(
      false
    );
    expect(
      ScenarioSeed.hasMemory(createMinimalScenarioSeed(), memoryRisk)
    ).toBe(true);
  });
});

describe("Scenario", () => {
  it("accepts a scenario", () => {
    expect(v.safeParse(Scenario.io, createScenario()).success).toBe(true);
  });

  it("rejects the childMaturity V2 scenarios carried", () => {
    expect(
      v.safeParse(Scenario.io, {
        ...createScenario(),
        childMaturity: "A child with moderate emotional development.",
      }).success
    ).toBe(false);
  });

  it("does not let the expansion model write a childMaturity", () => {
    const model = R.omit(createScenario(), ["seed", "firstUserMessage"]);
    expect(v.safeParse(ModelScenarioLight.io, model).success).toBe(true);
    expect(
      v.safeParse(ModelScenarioLight.io, {
        ...model,
        childMaturity:
          "A child with moderate emotional development and typical cognitive abilities.",
      }).success
    ).toBe(false);
  });
});
