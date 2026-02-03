import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {GenerateSeedsContext} from "../benchmark.js";
import {Program} from "../cli.js";
import {kora} from "../kora.js";
import {getStructuredResponse} from "./model.js";

export async function generateSeeds(
  _program: Program,
  modelSlug: string,
  outputFilePath: string
) {
  const context: GenerateSeedsContext = {
    getResponse: async request => ({
      output: await getStructuredResponse(
        modelSlug,
        request.messages,
        request.outputType,
        {maxTokens: request.maxTokens}
      ),
    }),
  };

  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});

  let progress: ReturnType<typeof Script.progress> | undefined;
  let seedCount = 0;

  for await (const event of kora.generateScenarioSeeds(context)) {
    if (!progress) {
      progress = Script.progress(event.total, text =>
        process.stdout.write(text)
      );
      continue;
    }

    for (const seed of event.items) {
      await fs.appendFile(outputFilePath, JSON.stringify(seed) + "\n");
      seedCount++;
      progress.increment(true);
    }
  }

  progress?.finish();
  console.log(`\nGenerated ${seedCount} seeds → ${outputFilePath}`);
}
