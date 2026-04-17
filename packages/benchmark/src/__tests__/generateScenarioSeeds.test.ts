import {describe, expect, it} from "vitest";
import {GenerateSeedsContext} from "../benchmark.js";
import {kora} from "../kora.js";
import {ModelScenarioSeed} from "../model/scenarioSeed.js";

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
