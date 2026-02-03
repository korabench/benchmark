#!/usr/bin/env npx tsx
/**
 * Converts scenarioSeeds.json and scenarios.json from JSON array format to JSONL format.
 *
 * For scenarioSeeds.json: Flattens the grouped structure so each seed becomes its own line
 * with all metadata (riskCategoryId, riskId, ageRange, motivation) included directly.
 *
 * For scenarios.json: Each scenario object becomes one line.
 */
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(import.meta.dirname, "../data");

interface Motivation {
  name: string;
  description: string;
}

interface ScenarioSeedGroup {
  riskCategoryId: string;
  riskId: string;
  ageRange: string;
  motivation: Motivation;
  seeds: Array<Record<string, unknown>>;
}

interface FlattenedSeed {
  riskCategoryId: string;
  riskId: string;
  ageRange: string;
  motivation: Motivation;
  [key: string]: unknown;
}

async function convertScenarioSeeds() {
  const inputPath = path.join(dataDir, "scenarioSeeds.json");
  const outputPath = path.join(dataDir, "scenarioSeeds.jsonl");

  console.log("Converting scenarioSeeds.json to JSONL...");

  const content = await readFile(inputPath, "utf-8");
  const groups: ScenarioSeedGroup[] = JSON.parse(content);

  // Flatten: each seed gets its own line with metadata included
  const flattenedSeeds: FlattenedSeed[] = groups.flatMap(group =>
    group.seeds.map(seed => ({
      ...seed,
      riskCategoryId: group.riskCategoryId,
      riskId: group.riskId,
      ageRange: group.ageRange,
      motivation: group.motivation,
    }))
  );

  const jsonlContent = flattenedSeeds.map(seed => JSON.stringify(seed)).join("\n") + "\n";
  await writeFile(outputPath, jsonlContent);

  console.log(`  Converted ${groups.length} groups (${flattenedSeeds.length} seeds) to ${outputPath}`);
}

async function convertScenarios() {
  const inputPath = path.join(dataDir, "scenarios.json");
  const outputPath = path.join(dataDir, "scenarios.jsonl");

  console.log("Converting scenarios.json to JSONL...");

  const content = await readFile(inputPath, "utf-8");
  const scenarios: Array<Record<string, unknown>> = JSON.parse(content);

  const jsonlContent = scenarios.map(scenario => JSON.stringify(scenario)).join("\n") + "\n";
  await writeFile(outputPath, jsonlContent);

  console.log(`  Converted ${scenarios.length} scenarios to ${outputPath}`);
}

async function main() {
  await convertScenarioSeeds();
  await convertScenarios();
  console.log("\nDone! You can now delete the original .json files if desired.");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
