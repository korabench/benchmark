import {
  MimesisPatch,
  Packs,
  RiskTaxonomy,
  RunStamp,
  Scenario,
  ScenarioRevision,
  ScenarioValidation,
  writeValidatedOpening,
  type ChildSimulatorRef,
  type OpeningValidationContext,
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
import {
  chainLabel,
  createChainModel,
  createSpecModel,
} from "../profiles/roleModels.js";
import {buildRunStamp} from "../stamp/buildRunStamp.js";
import {readScenariosFromJsonl} from "./runCommand.js";
import {createChildSimulator} from "./shared/childSimulator.js";
import {workSummary} from "./shared/executionSummary.js";
import {
  buildPassRateReport,
  formatPassRateReport,
  writePassRateReport,
} from "./shared/passRateReport.js";
import {isPrivatePath} from "./shared/privatePath.js";
import {resolveRiskIdFilter} from "./shared/riskFilters.js";
import {assertInputConforms} from "./shared/validateInputFile.js";
import {
  openLedger,
  populationRowOf,
  readLedger as readValidationLedger,
  standingRejections,
  validationPathsFor,
  type Ledger,
} from "./shared/validationLedger.js";

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
// Each opening is validated as expansion validates its own (the scenario
// validation, by the profile's expansion model): a rejected one is written
// again, up to `--max-attempts`. That includes a rejection of the scenario
// itself: it passed at expansion, so the new opening is what the validator
// objects to (typically a narrative that describes another opening). The
// scenario and its seed never change, and nothing is relabeled. An
// opening that still fails is kept, and named in the validation report next to
// the output: the corpus is written either way.
//
// An opening this child already wrote is not written again, unless `again`
// is set: the validation changed, and the openings are written again to pass
// the new one.
//
// Each opening is appended to a ledger as soon as it is written, so a run that
// stops part-way resumes where it was. The output is written once every
// scenario has its opening, in input order.
//

/** Validated openings per scenario, as `expandScenario` gives each model;
 * `--max-attempts` overrides it. */
const defaultMaxOpeningAttempts = 2;

/** One ledger line: a scenario's new opening and how it was written. */
const VLedgerRow = v.object({
  seedId: v.string(),
  /** `RunStamp.hash` of the revising run: a resume must match it. */
  stampHash: v.string(),
  firstUserMessage: v.string(),
  /** MIMESIS only: the draft before the editor's patch, and its outcome. */
  draft: v.optional(v.string()),
  /** Openings written and validated for this scenario (older ledgers: MIMESIS
   * drafts written, counting placeholder redraws). */
  attempts: v.optional(v.number()),
  /** The validation verdict on the opening kept. Absent in older ledgers,
   * written before openings were validated. */
  verdict: v.optional(v.picklist(["pass", "fail"])),
  /** Set when an operator wrote or edited the opening by hand (e.g. filled a
   * placeholder the child kept): how, appended to the revision's reason. */
  manualFill: v.optional(v.string()),
  outcome: v.optional(
    v.object({
      status: v.string(),
      issueCount: v.number(),
      editCount: v.number(),
      endMarkerRedraws: v.optional(v.number()),
      leaving: v.optional(v.nullable(v.boolean())),
    })
  ),
});

type LedgerRow = v.InferOutput<typeof VLedgerRow>;

/** The scenarios whose opening could not be written: `x/scenarios.jsonl` →
 * `x/scenarios.rejected.jsonl`, and `x/s.private.jsonl` →
 * `x/s.private.rejected.jsonl`, private like its output. */
export function rejectedOpeningsPathFor(outputFilePath: string): string {
  const {dir, name} = path.parse(outputFilePath);
  return path.join(dir, `${name}.rejected.jsonl`);
}

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
  validator: {label: string; model: Model},
  withChildSimulator: boolean,
  ledger: Ledger,
  isPrivate: boolean,
  priorRejections: number,
  maxAttempts: number,
  recheck: boolean
): Promise<Omit<LedgerRow, "seedId" | "stampHash">> {
  const language = scenario.stamp?.language;
  if (withChildSimulator && language && language !== "English") {
    throw new Error(
      `Scenario ${scenario.seed.id} is in ${language}: the MIMESIS patch supports English only.`
    );
  }
  // The draft and outcome of the opening kept: the last one written.
  const audit: {draft?: string; outcome?: PatchOutcome} = {};
  const context: OpeningValidationContext = {
    language,
    getResponse: async request => ({
      output: await validator.model.getStructuredResponse(request),
    }),
    getUserResponse: async request => ({
      output: await userModel.getTextResponse(request),
    }),
    ...(withChildSimulator
      ? {
          getChildResponse: createChildSimulator(userModel, {
            onDraft: draft => {
              audit.draft = draft;
            },
            onOutcome: outcome => {
              audit.outcome = outcome;
            },
          }),
        }
      : {}),
  };
  const written = await writeValidatedOpening(context, scenario, {
    maxAttempts,
    priorRejections,
    // The scenario passed validation at expansion; only its opening changed.
    retryAnyRejection: true,
    recheck,
    onVerdict: ({firstUserMessage, verdict, recheck: isRecheck}) =>
      ledger.record({
        stage: "opening",
        key: scenario.seed.id,
        seedId: scenario.seed.id,
        verdict: verdict.verdict,
        questions: ScenarioValidation.questionsOf(verdict.validation),
        reasons: verdict.reasons,
        ...(verdict.childVoiceRelaxed ? {childVoiceRelaxed: true} : {}),
        ...(isRecheck ? {recheck: true} : {}),
        generatorModel: withChildSimulator
          ? MimesisPatch.recipeRef().id
          : "user",
        validatorModel: validator.label,
        ...(verdict.verdict === "fail" ? {rejected: {firstUserMessage}} : {}),
        population: populationRowOf(scenario.seed, isPrivate),
      }),
  });
  return {
    firstUserMessage: written.firstUserMessage,
    ...audit,
    attempts: written.attempts,
    verdict: written.last.verdict,
  };
}

export interface ReviseOpeningsOptions {
  reason: string;
  riskIds?: readonly string[];
  concurrency?: number;
  /** Write again openings this child already wrote. */
  again?: boolean;
  /** Validated openings per scenario (default 2). */
  maxAttempts?: number;
  /** Validate a rejected opening a second time (`validateConfirmed`).
   * Default true. */
  recheck?: boolean;
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
  // An output written with openings that failed is unfinished: its reject
  // file says so, and a re-run of the same command completes it.
  const rejectedPath = rejectedOpeningsPathFor(outputFilePath);
  if ((await fileExists(outputFilePath)) && !(await fileExists(rejectedPath))) {
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
  if (alreadyRevised.length > 0 && !options.again) {
    throw new Error(
      `${alreadyRevised.length} scenario(s) already have openings by this child (e.g. ${alreadyRevised[0]!.seed.id}): nothing to revise. Pass --again to write them again.`
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
  // The validator of expansion: the profile's expansion chain.
  const validator = {
    label: chainLabel(roles.expansion),
    model: createChainModel(roles.expansion).model,
  };
  console.log(`Validating each opening with ${validator.label}.`);
  const validationPaths = validationPathsFor(outputFilePath);
  const validationLedger = await openLedger(validationPaths.ledger, {
    fresh: done.size === 0,
  });
  const priorRejections = standingRejections(
    (await readValidationLedger(validationPaths.ledger)).filter(
      row => row.stage === "opening"
    )
  );
  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  const progress = Script.progress(scenarios.length, text =>
    process.stdout.write(text)
  );
  R.times(scenarios.length - pending.length, () => progress.increment(true));
  const failures: {seedId: string; reasons: string}[] = [];
  await consume(
    transform(
      options.concurrency ?? 10,
      async (scenario: Scenario) => {
        try {
          const written = await writeOpening(
            scenario,
            userModel,
            validator,
            withChildSimulator,
            validationLedger,
            isPrivatePath(inputFilePath),
            priorRejections[scenario.seed.id] ?? 0,
            options.maxAttempts ?? defaultMaxOpeningAttempts,
            options.recheck ?? true
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
          failures.push({seedId: scenario.seed.id, reasons: message});
          progress.increment(false);
        }
      },
      pending
    )
  );
  progress.finish();

  const reused = scenarios.length - pending.length;
  // The corpus is written whatever failed: a scenario whose opening could not
  // be written keeps its stored one, and is listed in the reject file.
  const revised = scenarios.map(scenario => {
    const row = done.get(scenario.seed.id);
    if (!row) {
      return scenario;
    }
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
  const rows = scenarios.flatMap(s => done.get(s.seed.id) ?? []);
  const outcomes = R.countBy(
    rows.flatMap(row => row.outcome ?? []),
    outcome => outcome.status
  );
  const rewritten = rows.filter(row => (row.attempts ?? 1) > 1).length;
  const failed = rows.filter(row => row.verdict === "fail").length;
  console.log(
    `\nRevised ${revised.length} opening(s) → ${outputFilePath}` +
      (withChildSimulator
        ? `\nEditor outcomes: ${Object.entries(outcomes)
            .map(([status, count]) => `${status} ${count}`)
            .join(", ")}`
        : "") +
      `\nValidation: ${revised.length - failed} passed, ${failed} kept although rejected; written again after a rejection: ${rewritten}`
  );
  const report = buildPassRateReport({
    stage: "opening",
    rows: await readValidationLedger(validationPaths.ledger),
  });
  await writePassRateReport(validationPaths, report);
  console.log(`\n${formatPassRateReport(report)}`);
  console.log(
    `Report → ${validationPaths.reportMd} (and .json); every verdict → ${validationPaths.ledger}`
  );
  if (failures.length > 0) {
    await fs.writeFile(
      rejectedPath,
      failures
        .map(
          failure =>
            JSON.stringify({
              seedId: failure.seedId,
              reasons: failure.reasons,
            }) + "\n"
        )
        .join("")
    );
    console.log(
      `\n${failures.length} opening(s) could not be written; those scenarios keep their stored opening and are listed in ${rejectedPath}. Re-run the same command to retry them.`
    );
    return workSummary(
      "seed",
      scenarios.length,
      scenarios.length - failures.length,
      failures.length,
      reused
    );
  }
  await fs.rm(rejectedPath, {force: true});
  return workSummary("seed", scenarios.length, scenarios.length, 0, reused);
}
