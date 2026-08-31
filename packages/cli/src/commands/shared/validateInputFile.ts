import {
  Conformance,
  Packs,
  RiskRefIssue,
  Scenario,
  ScenarioSeed,
} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as readline from "node:readline";
import * as v from "valibot";

//
// Up-front taxonomy conformance for pipeline input files.
//
// Every command validates its whole input before constructing a single model,
// so a scenario set that does not match the active taxonomy fails immediately
// rather than part-way through a paid run. This deliberately does NOT reuse the
// commands' own readers: those apply the --risk-ids filter and yield bare
// records, whereas validation must see every line and know its line number.
//

export type InputKind = "seeds" | "scenarios" | "reassess";

//
// Reading.
//

async function* readLines(
  filePath: string
): AsyncGenerator<{lineNumber: number; line: string}> {
  const fh = await fs.open(filePath);
  try {
    const rl = readline.createInterface({input: fh.createReadStream()});
    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        yield {lineNumber, line: trimmed};
      }
    }
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** The seed of one record, whatever wrapper shape the file uses. */
function seedOf(kind: InputKind, record: unknown): ScenarioSeed {
  if (kind === "seeds") {
    return v.parse(ScenarioSeed.io, record);
  }
  const scenario =
    kind === "scenarios"
      ? record
      : (record as {scenario: unknown} | undefined)?.scenario;
  return v.parse(Scenario.io, scenario).seed;
}

//
// API.
//

/**
 * Validate every record in a JSONL input against the active taxonomy.
 * Throws `TaxonomyConformanceError` listing the offending lines, or returns the
 * number of records checked.
 */
export async function assertInputConforms(
  filePath: string,
  kind: InputKind
): Promise<number> {
  const {taxonomy} = Packs.current();
  const issues: RiskRefIssue[] = [];
  let count = 0;

  for await (const {lineNumber, line} of readLines(filePath)) {
    // A `reassess` input may be a JSON array rather than JSONL; those records
    // are validated by the command's own reader, so skip the wrapper lines.
    if (line === "[" || line === "]" || line === "[]") {
      continue;
    }
    const parsed = JSON.parse(line.replace(/,$/, ""));
    const seed = seedOf(kind, parsed);
    count++;

    const issue = Conformance.checkRiskRef(seed, taxonomy);
    if (issue) {
      issues.push({...issue, lineNumber, recordId: seed.id});
    }
  }

  Conformance.assertConforms(issues, filePath, taxonomy);
  return count;
}
