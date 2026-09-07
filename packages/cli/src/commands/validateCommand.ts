import * as fs from "node:fs/promises";
import {Program} from "../cli.js";
import {resolveEffectiveProfile} from "../profiles/effectiveProfile.js";
import {printProfile} from "../profiles/printProfile.js";
import {assertInputConforms, InputKind} from "./shared/validateInputFile.js";

//
// Kind detection.
//

/**
 * Infer the input kind from the first record's keys, so `--kind` is only needed
 * for genuinely ambiguous files. A seed has `riskId` at the top level, a
 * scenario nests it under `seed`, and a reassess record wraps a scenario.
 */
async function detectKind(filePath: string): Promise<InputKind> {
  const text = await fs.readFile(filePath, "utf-8");
  const firstLine = text
    .split("\n")
    .map(l => l.trim().replace(/,$/, ""))
    .find(l => l.length > 0 && l !== "[" && l !== "]");
  if (!firstLine) {
    throw new Error(`${filePath} contains no records.`);
  }

  const record = JSON.parse(firstLine);
  if (record.messages !== undefined && record.scenario !== undefined) {
    return "reassess";
  }
  if (record.seed !== undefined) {
    return "scenarios";
  }
  if (record.riskId !== undefined) {
    return "seeds";
  }
  throw new Error(
    `Could not infer the record kind of ${filePath}. Pass --kind explicitly.`
  );
}

//
// Command.
//

export interface ValidateCommandOptions {
  kind?: InputKind;
  packsOnly?: boolean;
}

export async function validateCommand(
  _program: Program,
  modelsJsonPath: string,
  inputFilePath: string,
  options: ValidateCommandOptions = {}
) {
  printProfile(resolveEffectiveProfile(modelsJsonPath));

  if (options.packsOnly) {
    return;
  }

  console.log("");
  const kind = options.kind ?? (await detectKind(inputFilePath));
  const count = await assertInputConforms(inputFilePath, kind);
  console.log(
    `OK: ${count} ${kind} record(s) in ${inputFilePath} conform to the taxonomy.`
  );
}
