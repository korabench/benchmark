import {Script} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import JsonParser from "jsonc-parser";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import OpenAI from "openai";
import PQueue from "p-queue";
import {v4 as uuid} from "uuid";
import * as v from "valibot";
import {AgeRange} from "../src/model/ageRange.js";
import {Motivation} from "../src/model/motivation.js";
import {Risk} from "../src/model/risk.js";
import {RiskCategory} from "../src/model/riskCategory.js";
import {ModelScenarioSeed, ScenarioSeed} from "../src/model/scenarioSeed.js";
import {ScenarioSeedSlice} from "../src/model/scenarioSeedSlice.js";
import {riskToScenarioSeedsPrompt} from "../src/prompts/riskToScenarioSeedsPrompt.js";
import {withRateLimitRetry} from "./rateLimitRetry.js";

//
// Setup.
//

const riskCategories = RiskCategory.listAll();
const motivations = Motivation.listAll();

const client = new OpenAI();
const queue = new PQueue({concurrency: 10});

//
// Build tasks.
//

interface Task {
  riskCategory: RiskCategory;
  risk: Risk;
  ageRange: AgeRange;
  motivation: Motivation;
}

const tasks = riskCategories.flatMap(riskCategory =>
  riskCategory.risks.flatMap(risk =>
    AgeRange.list.flatMap(ageRange =>
      motivations.map(
        (motivation): Task => ({
          riskCategory,
          risk,
          ageRange,
          motivation,
        })
      )
    )
  )
);

//
// Process a single task into a seed slice.
//

async function processTask(task: Task): Promise<ScenarioSeedSlice> {
  const {riskCategory, risk, ageRange, motivation} = task;
  const prompt = riskToScenarioSeedsPrompt(
    riskCategory,
    risk,
    ageRange,
    motivation,
    8
  );
  const VOutput = v.strictObject({seeds: v.array(ModelScenarioSeed.io)});
  const outputSchema = toJsonSchema(VOutput);

  const response = await withRateLimitRetry(() =>
    client.responses.create({
      model: "gpt-4o-2024-11-20",
      temperature: 1,
      input: [
        {role: "system", content: prompt.system},
        {role: "user", content: prompt.user},
      ],
      text: {
        format: {
          type: "json_schema",
          strict: true,
          schema: outputSchema as any,
          name: "output_schema",
        },
      },
    })
  );

  const result = v.parse(VOutput, JsonParser.parse(response.output_text));
  const seeds: ScenarioSeed[] = result.seeds.map(seed => ({
    ...seed,
    id: uuid(),
    riskCategoryId: riskCategory.id,
    riskId: risk.id,
    ageRange,
    motivation,
  }));

  return {
    riskCategoryId: riskCategory.id,
    riskId: risk.id,
    ageRange,
    motivation,
    seeds,
  };
}

//
// Execute tasks with concurrency limit.
//

const progress = Script.progress(tasks.length, s => process.stdout.write(s));
progress.render();

const seedSlices = await Promise.all(
  tasks.map(task =>
    queue.add(async () => {
      const result = await processTask(task);
      progress.increment(true);
      return result;
    })
  )
);

progress.finish();

//
// Write seeds file.
//

const seedsFilePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "data",
  "scenarioSeeds.json"
);

await fs.writeFile(seedsFilePath, JSON.stringify(seedSlices, undefined, 2));

console.log(`\nWrote ${seedSlices.length} seed slices to ${seedsFilePath}`);
