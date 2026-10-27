import {
  generateFirstUserMessage,
  hasPlaceholder,
  MimesisPatch,
  Packs,
  RiskCategory,
  RiskTaxonomy,
  RunStamp,
  Scenario,
  ScenarioRevision,
  type ChildSimulatorRef,
  type PatchOutcome,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as R from "remeda";
import {consume, transform} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
import {Model} from "../models/model.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
  RoleOverrides,
} from "../profiles/effectiveProfile.js";
import {createSpecModel} from "../profiles/roleModels.js";
import {buildRunStamp} from "../stamp/buildRunStamp.js";
import {readScenariosFromJsonl} from "./runCommand.js";
import {createChildSimulator} from "./shared/childSimulator.js";
import {workSummary} from "./shared/executionSummary.js";
import {isPrivatePath} from "./shared/privatePath.js";
import {resolveRiskIdFilter} from "./shared/riskFilters.js";
import {assertInputConforms} from "./shared/validateInputFile.js";

//
// Revise openings.
//
// A scenario's opening (`firstUserMessage`) is written once, into the corpus,
// by the child model: every run sends it as is. Switching the child model
// therefore means writing the openings again. This command does that, and
// nothing else: every other field, and the seed id, stays as it was, so what
// is keyed by the seed id (expert reviews, earlier runs) still resolves. The
// replaced text is kept in the record's `revisions`.
//
// Each opening is appended to a ledger as soon as it is written, so a run that
// stops part-way resumes where it was. The output is written once every
// scenario has its opening, in input order.
//

const maxOpeningAttempts = 3;

/** One ledger line: a scenario's new opening and how it was written. */
const VLedgerRow = v.object({
  seedId: v.string(),
  /** `RunStamp.hash` of the revising run: a resume must match it. */
  stampHash: v.string(),
  firstUserMessage: v.string(),
  /** MIMESIS only: the draft before the editor's patch, and its outcome. */
  draft: v.optional(v.string()),
  /** MIMESIS only: drafts written, one more for each opening redrawn because
   * it kept a bracketed placeholder. */
  attempts: v.optional(v.number()),
  /** Set when an operator wrote or edited the opening by hand (e.g. filled a
   * placeholder the child kept): how, appended to the revision's reason. */
  manualFill: v.optional(v.string()),
  outcome: v.optional(
    v.object({
      status: v.string(),
      issueCount: v.number(),
      editCount: v.number(),
    })
  ),
});

type LedgerRow = v.InferOutput<typeof VLedgerRow>;

/**
 * One ledger per output, always private: `x/scenarios.jsonl` →
 * `x/scenarios.revisions.private.jsonl`, `x/scenarios.private.jsonl` →
 * `x/scenarios.private.revisions.jsonl`.
 */
function ledgerPathFor(outputFilePath: string): string {
  const {dir, name} = path.parse(outputFilePath);
  return path.join(
    dir,
    isPrivatePath(outputFilePath)
      ? `${name}.revisions.jsonl`
      : `${name}.revisions.private.jsonl`
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

async function readLedger(ledgerPath: string): Promise<LedgerRow[]> {
  if (!(await fileExists(ledgerPath))) return [];
  const content = await fs.readFile(ledgerPath, "utf-8");
  return content
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => v.parse(VLedgerRow, JSON.parse(line)));
}

async function readScenarios(
  filePath: string,
  riskIds?: ReadonlySet<string>
): Promise<Scenario[]> {
  const scenarios: Scenario[] = [];
  for await (const scenario of readScenariosFromJsonl(filePath, {riskIds})) {
    scenarios.push(scenario);
  }
  return scenarios;
}

/** What wrote an opening: the child recipe, else the user model's name. */
function writerKey(
  childSimulator: ChildSimulatorRef | undefined,
  userModel: string | undefined
): string {
  return childSimulator
    ? `recipe:${childSimulator.hash}`
    : `model:${userModel}`;
}

/** Replace the opening, keeping the previous one in `revisions`. */
export function reviseOpening(
  scenario: Scenario,
  firstUserMessage: string,
  revision: Omit<ScenarioRevision, "field" | "previous">
): Scenario {
  return {
    ...scenario,
    firstUserMessage,
    revisions: [
      ...(scenario.revisions ?? []),
      {
        field: "firstUserMessage",
        previous: scenario.firstUserMessage,
        ...revision,
      },
    ],
  };
}

async function writeOpening(
  scenario: Scenario,
  userModel: Model,
  withChildSimulator: boolean
): Promise<Omit<LedgerRow, "seedId" | "stampHash">> {
  const language = scenario.stamp?.language;
  if (withChildSimulator) {
    if (language && language !== "English") {
      throw new Error(
        `Scenario ${scenario.seed.id} is in ${language}: the MIMESIS patch supports English only.`
      );
    }
    // An opening that keeps a bracketed placeholder ("[name]") is drawn again,
    // as expansion does for its own openings. Only here: the opening is
    // written once into the corpus, and runs never redraw a turn.
    const attempt = async (
      n: number
    ): Promise<Omit<LedgerRow, "seedId" | "stampHash">> => {
      const audit: {draft?: string; outcome?: PatchOutcome} = {};
      const child = createChildSimulator(userModel, {
        onDraft: draft => {
          audit.draft = draft;
        },
        onOutcome: outcome => {
          audit.outcome = outcome;
        },
      });
      const {output} = await child({scenario, messages: []});
      if (!hasPlaceholder(output))
        return {firstUserMessage: output, ...audit, attempts: n};
      if (n >= maxOpeningAttempts) {
        throw new Error(
          `Opening still contains bracketed placeholders after ${n} attempts: ${output}`
        );
      }
      return attempt(n + 1);
    };
    return attempt(1);
  }
  const riskCategory = RiskCategory.find(scenario.seed.riskCategoryId);
  const risk = RiskCategory.findRisk(riskCategory, scenario.seed.riskId);
  const firstUserMessage = await generateFirstUserMessage(
    {
      language,
      getUserResponse: async request => ({
        output: await userModel.getTextResponse(request),
      }),
    },
    risk,
    scenario
  );
  return {firstUserMessage};
}

export interface ReviseOpeningsOptions {
  reason: string;
  riskIds?: readonly string[];
  concurrency?: number;
}

export async function reviseOpeningsCommand(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  inputFilePath: string,
  outputFilePath: string,
  options: ReviseOpeningsOptions
) {
  const reason = options.reason.trim();
  if (!reason) throw new Error("--reason must say why the openings change.");
  if (path.resolve(inputFilePath) === path.resolve(outputFilePath)) {
    throw new Error("The output must be a new file, not the input.");
  }
  if (await fileExists(outputFilePath)) {
    throw new Error(
      `${outputFilePath} already exists: revise-openings never overwrites a corpus. Choose a new path.`
    );
  }
  if (isPrivatePath(inputFilePath) && !isPrivatePath(outputFilePath)) {
    throw new Error(
      `${inputFilePath} is private: its revision must be written to a private file too (".private." in the name).`
    );
  }

  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  const withChildSimulator = Boolean(roles.childSimulator);
  const childSimulator = withChildSimulator
    ? MimesisPatch.recipeRef()
    : undefined;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  console.log(
    `Writing openings with ${roles.user.name}` +
      (childSimulator
        ? ` through ${childSimulator.id}@${childSimulator.version} (${childSimulator.hash})...`
        : "...")
  );

  const total = await assertInputConforms(inputFilePath, "scenarios");
  console.log(
    `Validated ${total} scenario(s) against taxonomy "${RiskTaxonomy.label(Packs.current().taxonomy)}".`
  );
  const riskIdFilter = resolveRiskIdFilter(options.riskIds);
  if (riskIdFilter) {
    console.log(`Filtering to risk IDs: ${[...riskIdFilter].join(", ")}`);
  }
  const scenarios = await readScenarios(inputFilePath, riskIdFilter);
  const duplicates = R.pipe(
    R.countBy(scenarios, s => s.seed.id),
    R.entries(),
    R.filter(([, count]) => count > 1)
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Seed ids appear more than once in ${inputFilePath}: ${duplicates.map(([id]) => id).join(", ")}.`
    );
  }

  const stamp = await buildRunStamp({
    effective,
    modelsJsonPath,
    inputPath: inputFilePath,
  });
  const stampHash = RunStamp.hash(stamp);
  const writer = writerKey(childSimulator, roles.user.name);
  const alreadyRevised = scenarios.filter(scenario => {
    const last = scenario.revisions
      ?.filter(r => r.field === "firstUserMessage")
      .at(-1);
    return (
      last !== undefined &&
      writerKey(last.childSimulator, last.stamp.models.user?.name) === writer
    );
  });
  if (alreadyRevised.length > 0) {
    throw new Error(
      `${alreadyRevised.length} scenario(s) already have openings by this child (e.g. ${alreadyRevised[0]!.seed.id}): nothing to revise.`
    );
  }

  const ledgerPath = ledgerPathFor(outputFilePath);
  const prior = await readLedger(ledgerPath);
  const foreign = prior.find(row => row.stampHash !== stampHash);
  if (foreign) {
    throw new Error(
      `${ledgerPath} was written by another profile or prompt set (seed ${foreign.seedId}); move it aside to start over.`
    );
  }
  const done = new Map(prior.map(row => [row.seedId, row]));
  const pending = scenarios.filter(s => !done.has(s.seed.id));
  if (done.size > 0) {
    console.log(`Resuming: ${done.size} opening(s) already in ${ledgerPath}.`);
  }
  console.log(`Audit ledger → ${ledgerPath} (git-ignored)`);

  const userModel = createSpecModel(roles.user, {
    rejectTruncated: withChildSimulator,
  });
  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  const progress = Script.progress(scenarios.length, text =>
    process.stdout.write(text)
  );
  R.times(scenarios.length - pending.length, () => progress.increment(true));
  const failures: string[] = [];
  await consume(
    transform(
      options.concurrency ?? 10,
      async (scenario: Scenario) => {
        try {
          const written = await writeOpening(
            scenario,
            userModel,
            withChildSimulator
          );
          const row: LedgerRow = {
            seedId: scenario.seed.id,
            stampHash,
            ...written,
          };
          await fs.appendFile(ledgerPath, JSON.stringify(row) + "\n");
          done.set(row.seedId, row);
          progress.increment(true);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `\nOpening failed for seed ${scenario.seed.id}: ${message.slice(0, 300)}`
          );
          failures.push(scenario.seed.id);
          progress.increment(false);
        }
      },
      pending
    )
  );
  progress.finish();

  const reused = scenarios.length - pending.length;
  if (failures.length > 0) {
    console.log(
      `\n${failures.length} opening(s) failed. Re-run the same command to retry them; ${ledgerPath} keeps the others.`
    );
    return workSummary(
      "seed",
      scenarios.length,
      scenarios.length - failures.length,
      failures.length,
      reused
    );
  }

  const revised = scenarios.map(scenario => {
    const row = done.get(scenario.seed.id)!;
    return reviseOpening(scenario, row.firstUserMessage, {
      reason: row.manualFill ? `${reason}; ${row.manualFill}` : reason,
      ...(childSimulator ? {childSimulator} : {}),
      stamp,
    });
  });
  await fs.writeFile(
    outputFilePath,
    revised.map(scenario => JSON.stringify(scenario) + "\n").join("")
  );
  const rows = scenarios.map(s => done.get(s.seed.id)!);
  const outcomes = R.countBy(
    rows.flatMap(row => row.outcome ?? []),
    outcome => outcome.status
  );
  const redrawn = rows.filter(row => (row.attempts ?? 1) > 1).length;
  console.log(
    `\nRevised ${revised.length} opening(s) → ${outputFilePath}` +
      (withChildSimulator
        ? `\nEditor outcomes: ${Object.entries(outcomes)
            .map(([status, count]) => `${status} ${count}`)
            .join(", ")}; redrawn for a placeholder: ${redrawn}`
        : "")
  );
  return workSummary("seed", scenarios.length, scenarios.length, 0, reused);
}
