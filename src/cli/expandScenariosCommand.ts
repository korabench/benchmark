import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import {consume, flatTransform} from "streaming-iterables";
import * as v from "valibot";
import {ExpandScenarioContext} from "../benchmark.js";
import {Program} from "../cli.js";
import {kora} from "../kora.js";
import {Scenario} from "../model/scenario.js";
import {ScenarioSeed} from "../model/scenarioSeed.js";
import {ScenarioValidationError} from "../model/scenarioValidationError.js";
import {getStructuredResponse, getTextResponse} from "./model.js";

async function* readSeedsFromJsonl(
  filePath: string
): AsyncGenerator<ScenarioSeed> {
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield v.parse(ScenarioSeed.io, JSON.parse(trimmed));
  }
}

async function countJsonlLines(filePath: string): Promise<number> {
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  let count = 0;
  for await (const line of rl) {
    if (line.trim().length > 0) count++;
  }
  return count;
}

export async function expandScenariosCommand(
  _program: Program,
  modelSlug: string,
  userModelSlug: string,
  seedsFilePath: string,
  outputFilePath: string
) {
  const context: ExpandScenarioContext = {
    getResponse: async request => ({
      output: await getStructuredResponse(
        modelSlug,
        request.messages,
        request.outputType,
        {maxTokens: request.maxTokens}
      ),
    }),
    getUserResponse: async request => ({
      output: await getTextResponse(userModelSlug, request.messages, {
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      }),
    }),
  };

  const outputDir = path.dirname(outputFilePath);
  const tempDir = path.join(outputDir, ".kora-expand-tmp");
  await fs.mkdir(tempDir, {recursive: true});

  const totalSeeds = await countJsonlLines(seedsFilePath);
  const progress = Script.progress(totalSeeds, text =>
    process.stdout.write(text)
  );
  let failureCount = 0;
  await consume(
    flatTransform(
      10,
      async (seed: ScenarioSeed) => {
        const tempFile = path.join(tempDir, `${seed.id}.json`);

        // Check if already processed (graceful restart).
        try {
          await fs.access(tempFile);
          progress.increment(true);
          return [];
        } catch {
          // Not yet processed.
        }

        try {
          const scenarios = await kora.expandScenario(context, seed);
          await fs.writeFile(tempFile, JSON.stringify(scenarios));
          progress.increment(true);
        } catch (error) {
          if (error instanceof ScenarioValidationError) {
            console.error(
              `\nValidation failed for seed ${seed.id}: ${error.lastReasons}`
            );
            failureCount++;
            progress.increment(false);
          } else {
            throw error;
          }
        }

        return [];
      },
      readSeedsFromJsonl(seedsFilePath)
    )
  );

  progress.finish();

  if (failureCount > 0) {
    console.log(
      `\n${failureCount} seeds failed validation. Temp files kept at ${tempDir} for restart.`
    );
    console.log(`Re-run the command to retry failed seeds.`);
    return;
  }

  // Build final output from temp files.
  await fs.mkdir(outputDir, {recursive: true});
  const tempFiles = await fs.readdir(tempDir);
  let scenarioCount = 0;

  await fs.writeFile(outputFilePath, "");
  for (const file of tempFiles) {
    const content = await fs.readFile(path.join(tempDir, file), "utf-8");
    const scenarios = JSON.parse(content) as Scenario[];
    for (const scenario of scenarios) {
      await fs.appendFile(outputFilePath, JSON.stringify(scenario) + "\n");
      scenarioCount++;
    }
  }

  await fs.rm(tempDir, {recursive: true, force: true});

  console.log(`\nExpanded ${scenarioCount} scenarios → ${outputFilePath}`);
}
