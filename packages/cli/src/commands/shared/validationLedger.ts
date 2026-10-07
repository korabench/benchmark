import {
  RiskSignalType,
  ScenarioSeed,
  ValidationAnswer,
} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as R from "remeda";

//
// Validation ledger.
//
// One line per verdict of a validation step, pass or fail, for the seed
// plausibility check (`generate-seeds`) and the scenario validation
// (`expand-scenarios`). Every line carries the population row of the slot it
// was about, so that the rejections can be checked for children the filter
// turns down more often than others. Passes are recorded too: they are the
// denominators of every pass rate.
//
// The ledger names which slots are private and quotes rejected text, so it is
// written as a private file (`.private.` in its name), which git ignores.
//

/** The assigned values of a seed: who the child is and what was asked for. */
export interface PopulationRow {
  riskCategoryId: string;
  riskId: string;
  goldStandardId?: string;
  situationType?: string;
  scenarioFlavorId?: string;
  ageRange: string;
  childAge: number;
  childGender: string;
  childRaceEthnicity: string;
  childSES?: string;
  motivation: string;
  use?: string;
  socialContext: string;
  riskSignalType: string;
  refusalBehavior?: string;
  memory?: string;
  private: boolean;
}

export type ValidationStage = "seed" | "expansion";

export interface ValidationAttempt {
  stage: ValidationStage;
  /** What the attempt was for: the seed slot key, or the seed id at expansion. */
  key: string;
  /** Id of the seed checked (seed stage) or expanded (expansion stage). */
  seedId: string;
  /** 1-based per key, counted over every run that wrote to the ledger. */
  attempt: number;
  verdict: "pass" | "fail";
  /** The answer and reason given to every yes/no question. */
  questions?: Readonly<Record<string, ValidationAnswer>>;
  /** Expansion stage: why the scenario was rejected, or the checklist reasons. */
  reasons?: string;
  /** Expansion stage: the child-voice check was relaxed for this verdict
   * (temporary; `ScenarioValidation.relaxesChildVoice`). Absent when not. */
  childVoiceRelaxed?: true;
  /** Expansion stage: the scenario of the previous attempt was kept and only
   * its first user message was written again. Absent when not. */
  firstMessageRewrite?: true;
  /** Expansion stage: the seed's risk signal type was relabeled before this
   * attempt, from this assigned value (`relabelSignalType`). Absent when the
   * seed carries its assigned value. */
  relabeledFrom?: RiskSignalType;
  generatorModel: string;
  validatorModel: string;
  /** The text that was rejected; absent on a pass. */
  rejected?: Record<string, string>;
  population: PopulationRow;
  at: string;
}

export interface ValidationPaths {
  ledger: string;
  reportMd: string;
  reportJson: string;
}

export interface Ledger {
  /** Append one verdict; its attempt number follows the key's earlier ones. */
  record(row: Omit<ValidationAttempt, "attempt" | "at">): Promise<void>;
}

export function populationRowOf(
  seed: ScenarioSeed,
  isPrivate: boolean
): PopulationRow {
  return {
    riskCategoryId: seed.riskCategoryId,
    riskId: seed.riskId,
    ...(seed.goldStandardId ? {goldStandardId: seed.goldStandardId} : {}),
    ...(seed.situationType ? {situationType: seed.situationType} : {}),
    ...(seed.scenarioFlavorId ? {scenarioFlavorId: seed.scenarioFlavorId} : {}),
    ageRange: seed.ageRange,
    childAge: seed.childAge,
    childGender: seed.childGender,
    childRaceEthnicity: seed.childRaceEthnicity,
    ...(seed.childSES ? {childSES: seed.childSES} : {}),
    motivation: seed.motivation.name,
    ...(seed.use ? {use: seed.use} : {}),
    socialContext: seed.socialContext,
    riskSignalType: seed.riskSignalType,
    ...(seed.refusalBehavior ? {refusalBehavior: seed.refusalBehavior} : {}),
    ...(seed.memory ? {memory: seed.memory} : {}),
    private: isPrivate,
  };
}

/**
 * Where the ledger and the pass-rate report of `outputFilePath` go:
 * `data/seeds.jsonl` → `data/seeds.validation.private.jsonl`,
 * `data/seeds.validation-report.md` and `.json`.
 */
export function validationPathsFor(outputFilePath: string): ValidationPaths {
  const {dir, name} = path.parse(outputFilePath);
  return {
    ledger: path.join(dir, `${name}.validation.private.jsonl`),
    reportMd: path.join(dir, `${name}.validation-report.md`),
    reportJson: path.join(dir, `${name}.validation-report.json`),
  };
}

/** Every line of the ledger at `filePath`; empty when there is none. */
export async function readLedger(
  filePath: string
): Promise<ValidationAttempt[]> {
  const content = await fs.readFile(filePath, "utf-8").catch(() => "");
  return content
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as ValidationAttempt);
}

/**
 * Open the ledger at `filePath` for appending. `fresh` starts it over;
 * otherwise attempt numbers continue from the lines already there.
 */
export async function openLedger(
  filePath: string,
  options: {fresh: boolean}
): Promise<Ledger> {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  if (options.fresh) {
    await fs.writeFile(filePath, "");
  }
  // Mutated on every record: verdicts arrive concurrently, and each must take
  // the next number of its key before the write yields.
  const attempts = new Map(
    Object.entries(R.countBy(await readLedger(filePath), row => row.key))
  );

  return {
    record: async row => {
      const attempt = (attempts.get(row.key) ?? 0) + 1;
      attempts.set(row.key, attempt);
      const line: ValidationAttempt = {
        ...row,
        attempt,
        at: new Date().toISOString(),
      };
      await fs.appendFile(filePath, JSON.stringify(line) + "\n");
    },
  };
}
