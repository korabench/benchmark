import {Mechanism, Packs, RiskTaxonomy} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import {Program} from "../cli.js";
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
// Reporting.
//

function printPacks(): void {
  const {taxonomy, behaviors} = Packs.current();
  const stamp = Packs.fingerprint();

  console.log(
    `Taxonomy:  ${RiskTaxonomy.label(taxonomy)} (${stamp.taxonomy.hash})`
  );
  console.log(
    `           ${taxonomy.categories.length} categories, ${RiskTaxonomy.allRisks(taxonomy).length} risks`
  );
  console.log(
    `Behaviors: ${behaviors.id}@${behaviors.version} (${stamp.behaviors.hash})`
  );
  console.log(
    `           ${behaviors.behaviors.map(Mechanism.codeOf).join(", ")}`
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
  inputFilePath: string,
  options: ValidateCommandOptions = {}
) {
  printPacks();

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
