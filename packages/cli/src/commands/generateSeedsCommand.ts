import {
  GenerateSeedsContext,
  GenerateSeedsOptions,
  kora,
  largestRemainderCounts,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {Program} from "../cli.js";
import {createGatewayModel} from "../models/gatewayModel.js";

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, v]) => `${k}:${v}`)
    .join("/");
}

export async function generateSeeds(
  _program: Program,
  modelsJsonPath: string,
  modelSlug: string,
  outputFilePath: string,
  options?: GenerateSeedsOptions
) {
  console.log(`Generating seeds using ${modelSlug}...`);
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
  }

  const model = createGatewayModel(modelsJsonPath, modelSlug);

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
