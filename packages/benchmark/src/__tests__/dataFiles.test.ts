import * as fs from "node:fs";
import * as readline from "node:readline";
import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {Scenario} from "../model/scenario.js";
import {ScenarioSeed} from "../model/scenarioSeed.js";

//
// Helpers.
//

const dataDir = new URL("../../../../data", import.meta.url).pathname;

async function* readJsonlLines(
  filePath: string
): AsyncGenerator<{lineNumber: number; line: string}> {
  const rl = readline.createInterface({input: fs.createReadStream(filePath)});
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (trimmed.length > 0) yield {lineNumber, line: trimmed};
  }
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

//
// Tests.
//

describe("scenarioSeeds.jsonl", () => {
  const filePath = `${dataDir}/scenarioSeeds.jsonl`;

  it.skipIf(!fileExists(filePath))(
    "every line parses as a valid ScenarioSeed",
    async () => {
      let count = 0;
      for await (const {lineNumber, line} of readJsonlLines(filePath)) {
        const parsed = JSON.parse(line);
        const result = v.safeParse(ScenarioSeed.io, parsed);
        expect(
          result.success,
          `Line ${lineNumber}: ${result.issues?.[0]?.message}`
        ).toBe(true);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    }
  );
});

describe("scenarios.jsonl", () => {
  const filePath = `${dataDir}/scenarios.jsonl`;

  it.skipIf(!fileExists(filePath))(
    "every line parses as a valid Scenario",
    async () => {
      let count = 0;
      for await (const {lineNumber, line} of readJsonlLines(filePath)) {
        const parsed = JSON.parse(line);
        const result = v.safeParse(Scenario.io, parsed);
        expect(
          result.success,
          `Line ${lineNumber}: ${result.issues?.[0]?.message}`
        ).toBe(true);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    }
  );
});
