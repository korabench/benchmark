import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {GenerateSeedsContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {populationDistributionPresets} from "../model/populationDistributionPresets.js";
import {ModelScenarioSeed, ScenarioSeed} from "../model/scenarioSeed.js";

//
// Fixtures.
//

function makeFakeSeed(): ModelScenarioSeed {
  return {
    childAge: 8,
    childGender: "male",
    childRaceEthnicity: "white",
    childCognitiveMaturity: "medium",
    childEmotionalMaturity: "medium",
    shortTitle: "Test seed",
    riskSignalType: "subtle",
    coreBehavior: "Core behavior description for the test fixture.",
    socialContext: "alone",
    context:
      "Context describing the situation in which the child is interacting.",
    notes: "",
  };
}

interface Call {
  userPrompt: string;
}

function makeContext(calls: Call[]): GenerateSeedsContext {
  return {
    getResponse: async request => {
      const userMessage = request.messages.find(m => m.role === "user");
      calls.push({
        userPrompt:
          typeof userMessage?.content === "string" ? userMessage.content : "",
      });
      return {output: {seeds: [makeFakeSeed()]} as never};
    },
  };
}

async function runSeeds(
  context: GenerateSeedsContext,
  options?: Parameters<typeof kora.generateScenarioSeeds>[1]
) {
  const generator = kora.generateScenarioSeeds(context, options);
  for await (const event of generator) {
    void event;
  }
}

async function collectSeeds(
  context: GenerateSeedsContext,
  options?: Parameters<typeof kora.generateScenarioSeeds>[1]
): Promise<ScenarioSeed[]> {
  const seeds: ScenarioSeed[] = [];
  for await (const event of kora.generateScenarioSeeds(context, options)) {
    seeds.push(...event.items);
  }
  return seeds;
}

//
// Tests.
//

describe("generateScenarioSeeds riskIds filter", () => {
  it("restricts generation to the specified risk IDs", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      seedsPerTask: 1,
      ageRanges: ["7to9"],
      riskIds: ["privacy_and_personal_data_protection"],
    });

    // 1 risk × 1 age × 10 motivations = 10 tasks.
    expect(calls).toHaveLength(10);
    expect(
      calls.every(c =>
        c.userPrompt.includes("Privacy & Personal Data Protection")
      )
    ).toBe(true);
  });

  it("supports multiple risk IDs", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      seedsPerTask: 1,
      ageRanges: ["7to9"],
      riskIds: [
        "privacy_and_personal_data_protection",
        "sensorimotor_displacement",
      ],
    });

    // 2 risks × 1 age × 10 motivations = 20 tasks.
    expect(calls).toHaveLength(20);
  });

  it("throws on unknown risk IDs", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await expect(
      runSeeds(context, {
        seedsPerTask: 1,
        ageRanges: ["7to9"],
        riskIds: ["not_a_real_risk"],
      })
    ).rejects.toThrow(/Unknown risk IDs: not_a_real_risk/);
  });

  it("processes all risks when riskIds is omitted", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      seedsPerTask: 1,
      ageRanges: ["7to9"],
    });

    // Full taxonomy: 25 risks × 1 age × 10 motivations = 250 tasks.
    expect(calls.length).toBeGreaterThan(100);
  });

  it("restricts generation to the specified motivation", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      seedsPerTask: 1,
      ageRanges: ["7to9"],
      riskIds: ["privacy_and_personal_data_protection"],
      motivations: ["Curiosity / Exploration"],
    });

    // 1 risk × 1 age × 1 motivation = 1 task.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userPrompt).toContain("Curiosity / Exploration");
  });

  it("throws on unknown motivation names", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await expect(
      runSeeds(context, {
        seedsPerTask: 1,
        ageRanges: ["7to9"],
        motivations: ["Not A Real Motivation"],
      })
    ).rejects.toThrow(/Unknown motivation names: Not A Real Motivation/);
  });
});

describe("generateScenarioSeeds totalSeeds sampling", () => {
  it("samples totalSeeds distinct (age, motivation) combos per risk", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      totalSeeds: 5,
      riskIds: ["privacy_and_personal_data_protection"],
    });

    // totalSeeds=5 → 5 tasks, one seed each.
    expect(calls).toHaveLength(5);
  });

  it("applies totalSeeds per risk when multiple risks are given", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await runSeeds(context, {
      totalSeeds: 3,
      riskIds: [
        "privacy_and_personal_data_protection",
        "sensorimotor_displacement",
      ],
    });

    // 3 per risk × 2 risks = 6 tasks.
    expect(calls).toHaveLength(6);
  });

  it("throws when totalSeeds exceeds the number of combos", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await expect(
      runSeeds(context, {
        totalSeeds: 31,
        riskIds: ["privacy_and_personal_data_protection"],
      })
    ).rejects.toThrow(/--total-seeds \(31\) exceeds/);
  });

  it("rejects setting both seedsPerTask and totalSeeds", async () => {
    const calls: Call[] = [];
    const context = makeContext(calls);

    await expect(
      runSeeds(context, {
        seedsPerTask: 2,
        totalSeeds: 5,
        riskIds: ["privacy_and_personal_data_protection"],
      })
    ).rejects.toThrow(/mutually exclusive/);
  });
});

//
// Distribution-mode tests.
//

const census = populationDistributionPresets["us-census-2020"]!;

function makeReturn(
  seed: ModelScenarioSeed,
  calls: Call[]
): GenerateSeedsContext {
  return {
    getResponse: async request => {
      const userMessage = request.messages.find(m => m.role === "user");
      calls.push({
        userPrompt:
          typeof userMessage?.content === "string" ? userMessage.content : "",
      });
      return {output: {seeds: [seed]} as never};
    },
  };
}

describe("generateScenarioSeeds distribution mode", () => {
  it("fires exactly `totalSeeds` LLM calls per risk with pinned demographics", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 1,
    });

    expect(calls).toHaveLength(60);
    expect(seeds).toHaveLength(60);
    expect(calls.every(c => c.userPrompt.includes("PINNED VALUES"))).toBe(true);
  });

  it("overwrites LLM demographic drift with the pinned values", async () => {
    // Fake LLM always returns gender="male" & race="white", which the allocator
    // should overwrite.
    const calls: Call[] = [];
    const context = makeReturn(
      {...makeFakeSeed(), childGender: "male", childRaceEthnicity: "white"},
      calls
    );

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 42,
    });

    expect(R.countBy(seeds, s => s.ageRange)).toEqual({
      "7to9": 16,
      "10to12": 16,
      "13to17": 28,
    });
    expect(R.countBy(seeds, s => s.childGender)).toEqual({girl: 30, boy: 30});
    expect(R.countBy(seeds, s => s.childSES!)).toEqual({
      low: 17,
      middle: 28,
      high: 15,
    });
    expect(R.countBy(seeds, s => s.childRaceEthnicity)).toEqual({
      white: 31,
      hispanic: 15,
      black: 8,
      asian: 3,
      other: 3,
    });
  });

  it("overrides LLM-supplied childAge with the pinned integer in-bracket", async () => {
    const calls: Call[] = [];
    // LLM returns age=17 regardless — must be replaced with the pinned value.
    const context = makeReturn({...makeFakeSeed(), childAge: 17}, calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 3,
    });

    const inBracket = {
      "7to9": new Set([7, 8, 9]),
      "10to12": new Set([10, 11, 12]),
      "13to17": new Set([13, 14, 15, 16, 17]),
    } as const;
    for (const s of seeds) {
      expect(Number.isInteger(s.childAge)).toBe(true);
      expect(inBracket[s.ageRange].has(s.childAge)).toBe(true);
    }
  });

  it("overrides LLM-supplied maturity with the pinned uniform allocation", async () => {
    const calls: Call[] = [];
    // LLM always returns medium/medium — overwritten by the uniform allocation.
    const context = makeReturn(
      {
        ...makeFakeSeed(),
        childCognitiveMaturity: "medium",
        childEmotionalMaturity: "medium",
      },
      calls
    );

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 21,
    });

    expect(R.countBy(seeds, s => s.childCognitiveMaturity)).toEqual({
      low: 20,
      medium: 20,
      high: 20,
    });
    expect(R.countBy(seeds, s => s.childEmotionalMaturity)).toEqual({
      low: 20,
      medium: 20,
      high: 20,
    });
  });

  it("pins riskSignalType at 20/40/40 on every risk in distribution mode", async () => {
    const calls: Call[] = [];
    // LLM always returns "subtle" — should be overwritten by the pinned allocation.
    const context = makeReturn(
      {...makeFakeSeed(), riskSignalType: "subtle"},
      calls
    );

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 20,
      riskIds: ["bias_and_stereotyping"],
      randomSeed: 4,
    });

    expect(seeds).toHaveLength(20);
    expect(R.countBy(seeds, s => s.riskSignalType)).toEqual({
      direct: 4,
      subtle: 8,
      ambiguous: 8,
    });
    expect(calls.every(c => c.userPrompt.includes("Risk Signal Type:"))).toBe(
      true
    );
  });

  it("cycles motivations evenly (60 seeds / 10 motivations = 6 each)", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 1,
    });

    const counts = R.countBy(seeds, s => s.motivation.name);
    const values = Object.values(counts);
    expect(values.every(v => v === 6)).toBe(true);
    expect(values).toHaveLength(10);
  });

  it("throws when distribution is set without totalSeeds", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    await expect(
      runSeeds(context, {
        distribution: census,
        riskIds: ["privacy_and_personal_data_protection"],
      })
    ).rejects.toThrow(/--distribution requires --total-seeds/);
  });

  it("throws when distribution is combined with seedsPerTask", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    await expect(
      runSeeds(context, {
        distribution: census,
        totalSeeds: 10,
        seedsPerTask: 3,
        riskIds: ["privacy_and_personal_data_protection"],
      })
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("honors --age-ranges by restricting to that band (100% of personas)", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 30,
      ageRanges: ["10to12"],
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 9,
    });

    expect(seeds).toHaveLength(30);
    expect(seeds.every(s => s.ageRange === "10to12")).toBe(true);
    // Other dimensions still match the preset marginals.
    expect(R.countBy(seeds, s => s.childGender)).toEqual({girl: 15, boy: 15});
  });

  it("is reproducible across runs with the same randomSeed", async () => {
    const callsA: Call[] = [];
    const callsB: Call[] = [];
    const ctxA = makeReturn(makeFakeSeed(), callsA);
    const ctxB = makeReturn(makeFakeSeed(), callsB);

    const a = await collectSeeds(ctxA, {
      distribution: census,
      totalSeeds: 30,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 77,
    });
    const b = await collectSeeds(ctxB, {
      distribution: census,
      totalSeeds: 30,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 77,
    });

    const tuples = (ss: ScenarioSeed[]) =>
      ss.map(s => [
        s.ageRange,
        s.childGender,
        s.childSES,
        s.childRaceEthnicity,
        s.motivation.name,
        s.scenarioFlavorId,
      ]);
    expect(tuples(a)).toEqual(tuples(b));
  });
});

//
// Flavor-distribution tests.
//

describe("generateScenarioSeeds scenario-flavor allocation", () => {
  it("matches the per-risk flavor marginals when the risk defines flavors (7.3)", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 20,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 1,
    });

    expect(seeds).toHaveLength(20);
    expect(R.countBy(seeds, s => s.scenarioFlavorId!)).toEqual({
      a_direct: 5,
      b_gradual: 8,
      d_authority: 4,
      e_fictional: 3,
    });
  });

  it("threads each pinned flavor into its own LLM prompt", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    await collectSeeds(context, {
      distribution: census,
      totalSeeds: 20,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 1,
    });

    expect(
      calls.every(c => c.userPrompt.includes("PINNED SCENARIO FLAVOR"))
    ).toBe(true);
    expect(
      calls.filter(c => c.userPrompt.includes("Flavor id: b_gradual"))
    ).toHaveLength(8);
  });

  it("overrides the allocator's riskSignalType when the pinned flavor sets one (privacy 7.3)", async () => {
    const calls: Call[] = [];
    // LLM always returns "subtle" — should be overwritten by the flavor-specific
    // riskSignalType (a_direct→direct, b_gradual→subtle, d_authority/e_fictional→ambiguous).
    const context = makeReturn(
      {...makeFakeSeed(), riskSignalType: "subtle"},
      calls
    );

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 20,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 1,
    });

    const flavorSignalPairs = R.countBy(
      seeds,
      s => `${s.scenarioFlavorId}:${s.riskSignalType}`
    );
    expect(flavorSignalPairs).toEqual({
      "a_direct:direct": 5,
      "b_gradual:subtle": 8,
      "d_authority:ambiguous": 4,
      "e_fictional:ambiguous": 3,
    });
  });

  it("leaves scenarioFlavorId undefined for risks without flavors", async () => {
    const calls: Call[] = [];
    const context = makeReturn(makeFakeSeed(), calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 10,
      riskIds: ["sensorimotor_displacement"],
      randomSeed: 1,
    });

    expect(seeds).toHaveLength(10);
    expect(seeds.every(s => s.scenarioFlavorId === undefined)).toBe(true);
    expect(
      calls.some(c => c.userPrompt.includes("PINNED SCENARIO FLAVOR"))
    ).toBe(false);
  });
});
