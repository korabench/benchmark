import {Scenario, ScenarioPrompt} from "@korabench/benchmark";
import {ModelMessage} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as readline from "node:readline";
import * as v from "valibot";

// Uses `object` (not `strictObject`) so prod dumps carrying extra fields
// (riskId, runId, seedId, assessment, behaviorAssessment, key, ageRange, ...)
// parse without error — we only need the five canonical fields below.
export const ReassessInput = v.object({
  id: v.string(),
  modelId: v.string(),
  scenario: Scenario.io,
  prompt: ScenarioPrompt.io,
  messages: v.array(ModelMessage.io),
});

export type ReassessInput = v.InferOutput<typeof ReassessInput>;

export interface ReassessInputFilters {
  riskIds?: ReadonlySet<string>;
  targetModels?: ReadonlySet<string>;
}

async function firstNonWhitespaceChar(filePath: string): Promise<string> {
  const fh = await fs.open(filePath);
  try {
    const {buffer} = await fh.read({length: 64});
    const text = buffer.toString("utf-8");
    const match = text.match(/\S/);
    return match ? match[0] : "";
  } finally {
    await fh.close();
  }
}

async function* iterateRecords(
  filePath: string
): AsyncGenerator<ReassessInput> {
  const firstChar = await firstNonWhitespaceChar(filePath);
  if (firstChar === "[") {
    // JSON array: parse whole file (acceptable — prod dumps are moderate size).
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array at ${filePath}`);
    }
    for (const entry of parsed) {
      yield v.parse(ReassessInput, entry);
    }
    return;
  }

  // JSONL (one record per line).
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield v.parse(ReassessInput, JSON.parse(trimmed));
  }
}

export async function* readReassessInputsFromJsonl(
  filePath: string,
  filters?: ReassessInputFilters
): AsyncGenerator<ReassessInput> {
  for await (const record of iterateRecords(filePath)) {
    if (filters?.riskIds && !filters.riskIds.has(record.scenario.seed.riskId)) {
      continue;
    }
    if (filters?.targetModels && !filters.targetModels.has(record.modelId)) {
      continue;
    }
    yield record;
  }
}
