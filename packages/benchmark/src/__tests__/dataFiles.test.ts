import * as fs from "node:fs";
import * as readline from "node:readline";
import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {Scenario} from "../model/scenario.js";
import {ScenarioSeed} from "../model/scenarioSeed.js";
import {Conformance} from "../packs/conformance.js";
import {Packs} from "../packs/packs.js";

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

// The shipped corpus was generated against the legacy taxonomy, whose privacy
// risk defines the scenario flavors its seeds carry.
function checkAgainstLegacyTaxonomy(seed: ScenarioSeed) {
  return Packs.run({taxonomy: Packs.legacyTaxonomy()}, () =>
    Conformance.checkRiskRef(seed)
  );
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

  // Shape alone is not enough: riskCategoryId/riskId are plain strings, so a
  // seed can parse cleanly and still reference a risk the taxonomy dropped.
  it.skipIf(!fileExists(filePath))(
    "every seed resolves against the legacy taxonomy",
    async () => {
      for await (const {lineNumber, line} of readJsonlLines(filePath)) {
        const seed = v.parse(ScenarioSeed.io, JSON.parse(line));
        const issue = checkAgainstLegacyTaxonomy(seed);
        expect(issue, `Line ${lineNumber}: ${issue?.detail}`).toBeUndefined();
      }
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

  it.skipIf(!fileExists(filePath))(
    "every scenario resolves against the legacy taxonomy",
    async () => {
      for await (const {lineNumber, line} of readJsonlLines(filePath)) {
        const {seed} = v.parse(Scenario.io, JSON.parse(line));
        const issue = checkAgainstLegacyTaxonomy(seed);
        expect(issue, `Line ${lineNumber}: ${issue?.detail}`).toBeUndefined();
      }
    }
  );
});
