import {
  GenerateSeedsContext,
  GenerateSeedsOptions,
  kora,
  largestRemainderCounts,
  RiskCategory,
  Stamp,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {Program} from "../cli.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
  RoleOverrides,
} from "../profiles/effectiveProfile.js";
import {chainLabel, createChainModel} from "../profiles/roleModels.js";
import {buildRunStamp} from "../stamp/buildRunStamp.js";

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, v]) => `${k}:${v}`)
    .join("/");
}

export async function generateSeeds(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  outputFilePath: string,
  options?: GenerateSeedsOptions
) {
  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  Stamp.configure(await buildRunStamp({effective, modelsJsonPath}));
  console.log(
    roles.seeds.length === 1
      ? `Generating seeds using ${chainLabel(roles.seeds)}...`
      : `Generating seeds with fallback chain: ${chainLabel(roles.seeds)}`
  );
  if (options?.riskIds?.length) {
    console.log(`Filtering to risk IDs: ${options.riskIds.join(", ")}`);
  }
  if (options?.motivations?.length) {
    console.log(`Filtering to motivations: ${options.motivations.join(", ")}`);
  }
  if (options?.distribution && options.totalSeeds !== undefined) {
    const d = options.distribution;
    const n = options.totalSeeds;
    console.log(`Population distribution: ${d.name}`);
    console.log(
      `  Per-risk allocation at totalSeeds=${n}: ` +
        `age=${formatCounts(largestRemainderCounts(d.ageRange, n))} | ` +
        `gender=${formatCounts(largestRemainderCounts(d.gender, n))} | ` +
        `ses=${formatCounts(largestRemainderCounts(d.ses, n))} | ` +
        `race=${formatCounts(largestRemainderCounts(d.raceEthnicity, n))}`
    );
    if (options.randomSeed !== undefined) {
      console.log(`  Random seed: ${options.randomSeed}`);
    }

    const riskIdSet = options.riskIds ? new Set(options.riskIds) : undefined;
    const flavoredRisks = RiskCategory.listAll()
      .flatMap(c => c.risks)
      .filter(r => r.scenarioFlavors?.length)
      .filter(r => !riskIdSet || riskIdSet.has(r.id));
    for (const risk of flavoredRisks) {
      const proportions = Object.fromEntries(
        risk.scenarioFlavors!.map(f => [f.id, f.proportion])
      );
      console.log(
        `  Flavor allocation for ${risk.id}: ${formatCounts(largestRemainderCounts(proportions, n))}`
      );
    }
  }

  const {model} = createChainModel(roles.seeds);

  const context: GenerateSeedsContext = {
    getResponse: async request => ({
      output: await model.getStructuredResponse(request),
    }),
  };

  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  await fs.writeFile(outputFilePath, ""); // Clear file before starting

  const generator = kora.generateScenarioSeeds(context, options);
  const first = await generator.next();
  if (first.done) {
    console.log("\nNo seeds to generate.");
    return;
  }

  const progress = Script.progress(first.value.total, text =>
    process.stdout.write(text)
  );
  let seedCount = 0;

  for await (const event of generator) {
    for (const seed of event.items) {
      await fs.appendFile(outputFilePath, JSON.stringify(seed) + "\n");
      seedCount++;
      progress.increment(true);
    }
  }

  progress.finish();
  console.log(`\nGenerated ${seedCount} seeds → ${outputFilePath}`);
}
