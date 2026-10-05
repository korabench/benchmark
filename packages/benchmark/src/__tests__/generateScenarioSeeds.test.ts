import * as R from "remeda";
import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {GenerateSeedsContext} from "../benchmark.js";
import {DEFAULT_TOTAL_SEEDS, kora} from "../kora.js";
import {AgeRange} from "../model/ageRange.js";
import {populationDistributionPresets} from "../model/populationDistributionPresets.js";
import {RiskCategory} from "../model/riskCategory.js";
import {
  ModelScenarioSeed,
  RefusalBehavior,
  RiskSignalType,
  ScenarioSeed,
  SeedUse,
  SocialContext,
} from "../model/scenarioSeed.js";
import {Packs} from "../packs/packs.js";

//
// Fixtures.
//

function makeFakeSeed(): ModelScenarioSeed {
  return {
    shortTitle: "Test seed",
    coreBehavior: "Core behavior description for the test fixture.",
    context:
      "Context describing the situation in which the child is interacting.",
    notes: "",
  };
}

interface Call {
  userPrompt: string;
}

/** A fake seed model that records every prompt and always answers `output`. */
function makeContext(
  calls: Call[],
  output: unknown = makeFakeSeed()
): GenerateSeedsContext {
  return {
    getResponse: async request => {
      const userMessage = request.messages.find(m => m.role === "user");
      calls.push({
        userPrompt:
          typeof userMessage?.content === "string" ? userMessage.content : "",
      });
      return {output: output as never};
    },
  };
}

type Options = Parameters<typeof kora.generateScenarioSeeds>[1];

async function collectSeeds(
  context: GenerateSeedsContext,
  options?: Options
): Promise<ScenarioSeed[]> {
  const seeds: ScenarioSeed[] = [];
  for await (const event of kora.generateScenarioSeeds(context, options)) {
    seeds.push(...event.items);
  }
  return seeds;
}

const census = populationDistributionPresets["us-children-2020"]!;
const privacy = "privacy_and_personal_data_protection";
const riskCount = RiskCategory.listAll().flatMap(c => c.risks).length;

/** Sorted per-value counts, e.g. [8, 8, 8, 9, 9, 9, 9]. */
function sortedCounts<T>(items: readonly T[], key: (item: T) => string) {
  return Object.values(R.countBy(items, key)).sort((a, b) => a - b);
}

//
// Filters and defaults.
//

describe("generateScenarioSeeds filters", () => {
  it("restricts generation to the specified risk IDs", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
      totalSeeds: 10,
      riskIds: [privacy],
    });

    // One model call per seed.
    expect(calls).toHaveLength(10);
    expect(seeds).toHaveLength(10);
    expect(
      calls.every(c =>
        c.userPrompt.includes("Privacy & Personal Data Protection")
      )
    ).toBe(true);
  });

  it("applies totalSeeds per risk when multiple risks are given", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
      totalSeeds: 3,
      riskIds: [privacy, "sensorimotor_displacement"],
    });

    expect(calls).toHaveLength(6);
    expect(R.countBy(seeds, s => s.riskId)).toEqual({
      [privacy]: 3,
      sensorimotor_displacement: 3,
    });
  });

  it("throws on unknown risk IDs", async () => {
    await expect(
      collectSeeds(makeContext([]), {
        totalSeeds: 1,
        riskIds: ["not_a_real_risk"],
      })
    ).rejects.toThrow(
      /Unknown risk IDs for taxonomy "kora@3": not_a_real_risk/
    );
  });

  it("processes all risks when riskIds is omitted", async () => {
    const calls: Call[] = [];

    await collectSeeds(makeContext(calls), {totalSeeds: 2});

    expect(calls).toHaveLength(2 * riskCount);
  });

  it("spreads seeds over the specified motivations only", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
      totalSeeds: 4,
      riskIds: [privacy],
      motivations: ["Curiosity / Exploration"],
    });

    expect(seeds).toHaveLength(4);
    expect(
      seeds.every(s => s.motivation.name === "Curiosity / Exploration")
    ).toBe(true);
    expect(
      calls.every(c => c.userPrompt.includes("Curiosity / Exploration"))
    ).toBe(true);
  });

  it("throws on unknown motivation names", async () => {
    await expect(
      collectSeeds(makeContext([]), {
        totalSeeds: 1,
        motivations: ["Not A Real Motivation"],
      })
    ).rejects.toThrow(/Unknown motivation names: Not A Real Motivation/);
  });

  it("rejects a totalSeeds that is not a non-negative integer", async () => {
    await expect(
      collectSeeds(makeContext([]), {totalSeeds: Number.NaN})
    ).rejects.toThrow(/--total-seeds must be a non-negative integer/);
    await expect(
      collectSeeds(makeContext([]), {totalSeeds: -1})
    ).rejects.toThrow(/--total-seeds must be a non-negative integer/);
  });

  it("defaults to DEFAULT_TOTAL_SEEDS per risk and the census distribution", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
      riskIds: [privacy],
      randomSeed: 5,
    });

    expect(DEFAULT_TOTAL_SEEDS).toBe(75);
    expect(seeds).toHaveLength(75);
    // us-children-2020 at 75: each count is floor(75 * p) or one more.
    const ages = R.countBy(seeds, s => s.ageRange);
    expect([20, 21]).toContain(ages["7to9"]);
    expect([20, 21]).toContain(ages["10to12"]);
    expect([34, 35]).toContain(ages["13to17"]);
    const genders = R.countBy(seeds, s => s.childGender);
    expect([36, 37]).toContain(genders.girl);
    expect([38, 39]).toContain(genders.boy);
  });
});

//
// Every dimension is allocated by code.
//

describe("generateScenarioSeeds dimension allocation", () => {
  it("fires exactly `totalSeeds` model calls per risk, each with its assignment", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 1,
    });

    expect(calls).toHaveLength(60);
    expect(seeds).toHaveLength(60);
    expect(calls.every(c => c.userPrompt.includes("ASSIGNED CHILD"))).toBe(
      true
    );
  });

  it("matches the population marginals for age band, gender, SES and race", async () => {
    const seeds = await collectSeeds(makeContext([]), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 42,
    });

    // Each count is floor(60 * p) or one more; which values get the +1 is
    // random by design so the remainder is not always on the same value.
    const withinRounding = (
      counts: Record<string, number>,
      proportions: Record<string, number>
    ) => {
      expect(R.sum(Object.values(counts))).toBe(60);
      Object.entries(proportions).forEach(([key, p]) => {
        const floor = Math.floor(p * 60);
        expect([floor, floor + 1]).toContain(counts[key] ?? 0);
      });
    };
    withinRounding(
      R.countBy(seeds, s => s.ageRange),
      census.ageRange
    );
    withinRounding(
      R.countBy(seeds, s => s.childGender),
      census.gender
    );
    withinRounding(
      R.countBy(seeds, s => s.childSES!),
      census.ses
    );
    withinRounding(
      R.countBy(seeds, s => s.childRaceEthnicity),
      census.raceEthnicity
    );
  });

  it("spreads exact ages evenly over every year of each band", async () => {
    const seeds = await collectSeeds(makeContext([]), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 3,
    });

    for (const band of AgeRange.list) {
      const inBand = seeds.filter(s => s.ageRange === band);
      const counts = R.countBy(inBand, s => String(s.childAge));
      // Every year of the band is used, and only those years.
      expect(
        Object.keys(counts)
          .map(Number)
          .sort((a, b) => a - b)
      ).toEqual([...AgeRange.years(band)]);
      const values = Object.values(counts);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });

  it("allocates motivation, social context, signal type, use and refusal behavior evenly", async () => {
    const seeds = await collectSeeds(makeContext([]), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 1,
    });

    // 60 / 10 motivations.
    expect(sortedCounts(seeds, s => s.motivation.name)).toEqual(
      Array.from({length: 10}, () => 6)
    );
    // 60 / 4.
    expect(R.countBy(seeds, s => s.socialContext)).toEqual(
      Object.fromEntries(SocialContext.list.map(value => [value, 15]))
    );
    // 60 / 3.
    expect(R.countBy(seeds, s => s.riskSignalType)).toEqual(
      Object.fromEntries(RiskSignalType.list.map(value => [value, 20]))
    );
    expect(R.countBy(seeds, s => s.refusalBehavior!)).toEqual(
      Object.fromEntries(RefusalBehavior.list.map(value => [value, 20]))
    );
    // 60 / 6.
    expect(R.countBy(seeds, s => s.use!)).toEqual(
      Object.fromEntries(SeedUse.list.map(value => [value, 10]))
    );
  });

  it("does not always hand the rounding remainder to the same value", async () => {
    // 10 seeds over 3 signal types: one type gets 4 per risk. Across risks it
    // must not be the same type every time.
    const seeds = await collectSeeds(makeContext([]), {
      totalSeeds: 10,
      randomSeed: 11,
    });

    const favoured = Object.values(R.groupBy(seeds, s => s.riskId)).map(
      riskSeeds => {
        const counts = R.countBy(riskSeeds, s => s.riskSignalType);
        expect(Object.values(counts).sort()).toEqual([3, 3, 4]);
        return RiskSignalType.list.find(type => counts[type] === 4);
      }
    );
    expect(new Set(favoured).size).toBeGreaterThan(1);
  });

  it("takes no dimension from the model, whatever it returns", async () => {
    // A model that ignores its schema and returns dimensions of its own.
    const rogue = {
      ...makeFakeSeed(),
      childAge: 17,
      childGender: "male",
      childRaceEthnicity: "white",
      riskSignalType: "direct",
      socialContext: "alone",
      use: "homework",
      refusalBehavior: "insists",
      childCognitiveMaturity: "medium",
      childEmotionalMaturity: "medium",
    };

    const seeds = await collectSeeds(makeContext([], rogue), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 7,
    });

    expect(R.countBy(seeds, s => s.riskSignalType)).toEqual({
      direct: 20,
      subtle: 20,
      ambiguous: 20,
    });
    // 48.8/51.2 over 60: 29-30 girls, whatever the model answered.
    expect([29, 30]).toContain(R.countBy(seeds, s => s.childGender).girl);
    expect(seeds.some(s => s.childAge !== 17)).toBe(true);
    expect(new Set(seeds.map(s => s.socialContext)).size).toBe(4);
    for (const seed of seeds) {
      expect(seed.childCognitiveMaturity).toBeUndefined();
      expect(seed.childEmotionalMaturity).toBeUndefined();
      // Strict schema: a stray model-provided key would fail here.
      expect(v.safeParse(ScenarioSeed.io, seed).success).toBe(true);
    }
  });

  it("sets memory from the risk definition", async () => {
    const seeds = await collectSeeds(makeContext([]), {
      totalSeeds: 3,
      riskIds: [privacy, "grooming_and_manipulation"],
      randomSeed: 1,
    });

    const memoryOf = (riskId: string) =>
      new Set(seeds.filter(s => s.riskId === riskId).map(s => s.memory));
    expect(memoryOf(privacy)).toEqual(new Set(["none"]));
    expect(memoryOf("grooming_and_manipulation")).toEqual(
      new Set(["established"])
    );
  });

  it("renders the assigned signal type, use and social context, but not the refusal behavior", async () => {
    const calls: Call[] = [];

    await collectSeeds(makeContext(calls), {
      distribution: census,
      totalSeeds: 60,
      riskIds: [privacy],
      randomSeed: 1,
    });

    expect(calls.filter(c => c.userPrompt.includes("- subtle: "))).toHaveLength(
      20
    );
    expect(
      calls.filter(c => c.userPrompt.includes("- peer_pressure: "))
    ).toHaveLength(15);
    expect(
      calls.filter(c => c.userPrompt.includes("- companionship: ")).length
    ).toBeGreaterThanOrEqual(8);
    // The refusal behavior drives later turns; it must not shape the seed.
    expect(
      calls.some(
        c =>
          c.userPrompt.includes("insists") ||
          c.userPrompt.includes("works_around")
      )
    ).toBe(false);
  });

  it("honors ageRanges by restricting to that band (100% of seeds)", async () => {
    const seeds = await collectSeeds(makeContext([]), {
      distribution: census,
      totalSeeds: 30,
      ageRanges: ["10to12"],
      riskIds: [privacy],
      randomSeed: 9,
    });

    expect(seeds).toHaveLength(30);
    expect(seeds.every(s => s.ageRange === "10to12")).toBe(true);
    expect(seeds.every(s => [10, 11, 12].includes(s.childAge))).toBe(true);
    // Other dimensions still match the preset marginals.
    expect(R.countBy(seeds, s => s.childGender)).toEqual({girl: 15, boy: 15});
  });

  it("holds out the same 30% of every risk's seeds as private by default", async () => {
    const events: {riskId: string; isPrivate: boolean}[] = [];
    for await (const event of kora.generateScenarioSeeds(makeContext([]), {
      totalSeeds: 75,
      randomSeed: 3,
    })) {
      events.push(
        ...event.items.map(seed => ({
          riskId: seed.riskId,
          isPrivate: event.private === true,
        }))
      );
    }

    const privateCounts = R.pipe(
      events,
      R.groupBy(e => e.riskId),
      R.mapValues(group => group.filter(e => e.isPrivate).length)
    );
    expect(Object.keys(privateCounts)).toHaveLength(riskCount);
    expect(R.unique(Object.values(privateCounts))).toEqual([23]);
  });

  it("gives public and private seeds the same distribution on every dimension", async () => {
    const seeds: {seed: ScenarioSeed; isPrivate: boolean}[] = [];
    for await (const event of kora.generateScenarioSeeds(makeContext([]), {
      totalSeeds: 75,
      randomSeed: 3,
    })) {
      seeds.push(
        ...event.items.map(seed => ({seed, isPrivate: event.private === true}))
      );
    }
    const share = seeds.filter(s => s.isPrivate).length / seeds.length;
    const dimensions: ((seed: ScenarioSeed) => string | number | undefined)[] =
      [
        s => s.ageRange,
        s => s.childAge,
        s => s.childGender,
        s => s.childRaceEthnicity,
        s => s.childSES,
        s => s.motivation.name,
        s => s.socialContext,
        s => s.riskSignalType,
        s => s.use,
        s => s.refusalBehavior,
      ];

    const gaps = dimensions.flatMap(dimension =>
      Object.values(R.groupBy(seeds, s => String(dimension(s.seed)))).map(
        group =>
          Math.abs(group.filter(s => s.isPrivate).length - group.length * share)
      )
    );
    // Every value holds out the overall private share, to within two seeds.
    expect(Math.max(...gaps)).toBeLessThan(2);

    // Every situation type keeps a public seed.
    const publicBySituation = R.pipe(
      seeds,
      R.groupBy(s => `${s.seed.goldStandardId}|${s.seed.situationType}`),
      R.mapValues(group => group.filter(s => !s.isPrivate).length)
    );
    expect(Math.min(...Object.values(publicBySituation))).toBeGreaterThan(0);
  });

  it("keeps every seed public at privateRatio 0, with the same assignments", async () => {
    const collect = async (privateRatio: number) => {
      const out: {use?: string; childAge: number; isPrivate: boolean}[] = [];
      for await (const event of kora.generateScenarioSeeds(makeContext([]), {
        totalSeeds: 12,
        randomSeed: 9,
        privateRatio,
      })) {
        out.push(
          ...event.items.map(seed => ({
            use: seed.use,
            childAge: seed.childAge,
            isPrivate: event.private === true,
          }))
        );
      }
      return out;
    };
    const dims = (seeds: Awaited<ReturnType<typeof collect>>) =>
      seeds.map(s => `${s.use}/${s.childAge}`).sort();

    const allPublic = await collect(0);
    const split = await collect(0.5);
    expect(allPublic.some(s => s.isPrivate)).toBe(false);
    expect(split.filter(s => s.isPrivate)).toHaveLength(split.length / 2);
    expect(dims(split)).toEqual(dims(allPublic));
  });

  it("rejects a privateRatio outside [0, 1]", async () => {
    await expect(
      collectSeeds(makeContext([]), {privateRatio: 1.5})
    ).rejects.toThrow(/private-ratio/);
  });

  it("is reproducible across runs with the same randomSeed", async () => {
    const options: Options = {
      distribution: census,
      totalSeeds: 30,
      riskIds: [privacy],
      randomSeed: 77,
    };

    const a = await collectSeeds(makeContext([]), options);
    const b = await collectSeeds(makeContext([]), options);
    const c = await collectSeeds(makeContext([]), {...options, randomSeed: 78});

    const tuples = (ss: ScenarioSeed[]) =>
      ss.map(s => [
        s.ageRange,
        s.childAge,
        s.childGender,
        s.childSES,
        s.childRaceEthnicity,
        s.motivation.name,
        s.socialContext,
        s.riskSignalType,
        s.use,
        s.refusalBehavior,
        s.memory,
        s.scenarioFlavorId,
      ]);
    expect(tuples(a)).toEqual(tuples(b));
    expect(tuples(a)).not.toEqual(tuples(c));
  });
});

//
// Flavor allocation.
//

describe("generateScenarioSeeds scenario-flavor allocation", () => {
  // No bundled risk defines flavors any more; the legacy privacy risk does.
  const withLegacyTaxonomy = <T>(fn: () => T): T =>
    Packs.run({taxonomy: Packs.legacyTaxonomy()}, fn);

  it("matches the per-risk flavor marginals when the risk defines flavors (legacy 7.3)", async () => {
    const seeds = await withLegacyTaxonomy(() =>
      collectSeeds(makeContext([]), {
        distribution: census,
        totalSeeds: 20,
        riskIds: [privacy],
        randomSeed: 1,
      })
    );

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

    await withLegacyTaxonomy(() =>
      collectSeeds(makeContext(calls), {
        distribution: census,
        totalSeeds: 20,
        riskIds: [privacy],
        randomSeed: 1,
      })
    );

    expect(
      calls.every(c => c.userPrompt.includes("PINNED SCENARIO FLAVOR"))
    ).toBe(true);
    expect(
      calls.filter(c => c.userPrompt.includes("Flavor id: b_gradual"))
    ).toHaveLength(8);
  });

  it("leaves scenarioFlavorId undefined for risks without flavors", async () => {
    const calls: Call[] = [];

    const seeds = await collectSeeds(makeContext(calls), {
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
