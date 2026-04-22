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
    expect(calls.every(c => c.userPrompt.includes("PINNED DEMOGRAPHICS"))).toBe(
      true
    );
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

  it("clamps childAge to the pinned band even if the LLM drifts", async () => {
    const calls: Call[] = [];
    // LLM returns age=17 regardless — must be clamped to the pinned band.
    const context = makeReturn({...makeFakeSeed(), childAge: 17}, calls);

    const seeds = await collectSeeds(context, {
      distribution: census,
      totalSeeds: 60,
      riskIds: ["privacy_and_personal_data_protection"],
      randomSeed: 3,
    });

    for (const s of seeds) {
      if (s.ageRange === "7to9") expect(s.childAge).toBeLessThanOrEqual(9);
      if (s.ageRange === "10to12") expect([10, 11, 12]).toContain(s.childAge);
    }
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
      ]);
    expect(tuples(a)).toEqual(tuples(b));
  });
});
