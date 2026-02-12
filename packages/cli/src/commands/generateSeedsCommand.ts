import {
  GenerateSeedsContext,
  GenerateSeedsOptions,
  kora,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {Program} from "../cli.js";
import {getStructuredResponse} from "../model.js";

export async function generateSeeds(
  _program: Program,
  modelsJsonPath: string,
  modelSlug: string,
  outputFilePath: string,
  options?: GenerateSeedsOptions
) {
  console.log(`Generating seeds using ${modelSlug}...`);

  const context: GenerateSeedsContext = {
    getResponse: async request => ({
      output: await getStructuredResponse(modelsJsonPath, modelSlug, request),
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
