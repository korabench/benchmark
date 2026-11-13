import {
  ExpandScenarioContext,
  GenerateSeedsContext,
  kora,
  MimesisPatch,
  Packs,
  regenerateSeed,
  relabelSignalType,
  relabelUse,
  RiskTaxonomy,
  Scenario,
  ScenarioSeed,
  ScenarioValidation,
  ScenarioValidationError,
  Stamp,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import * as R from "remeda";
import {consume, flatTransform} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
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
import {assertResumable, hasCachedFiles} from "./shared/cacheStamp.js";
import {createChildSimulator} from "./shared/childSimulator.js";
import {workSummary} from "./shared/executionSummary.js";
import {
  buildPassRateReport,
  formatPassRateReport,
  writePassRateReport,
} from "./shared/passRateReport.js";
import {isPrivatePath, privatePathFor} from "./shared/privatePath.js";
import {resolveRiskIdFilter} from "./shared/riskFilters.js";
import {assertInputConforms} from "./shared/validateInputFile.js";
import {
  openLedger,
  populationRowOf,
  readLedger,
  standingRejections,
  validationPathsFor,
} from "./shared/validationLedger.js";

async function* readSeedsFromJsonl(
  filePath: string,
  riskIdFilter?: ReadonlySet<string>
): AsyncGenerator<ScenarioSeed> {
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const seed = v.parse(ScenarioSeed.io, JSON.parse(trimmed));
    if (riskIdFilter && !riskIdFilter.has(seed.riskId)) continue;
    yield seed;
  }
}

/** The seeds of every file in turn. */
async function* readSeedsFromFiles(
  filePaths: readonly string[],
  riskIdFilter?: ReadonlySet<string>
): AsyncGenerator<ScenarioSeed> {
  for (const filePath of filePaths) {
    yield* readSeedsFromJsonl(filePath, riskIdFilter);
  }
}

async function readSeedIds(
  filePaths: readonly string[],
  riskIdFilter?: ReadonlySet<string>
): Promise<string[]> {
  const ids: string[] = [];
  for await (const seed of readSeedsFromFiles(filePaths, riskIdFilter)) {
    ids.push(seed.id);
  }
  return ids;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

/**
 * The private seed files read along with `seedsFilePath`: the file itself when
 * it is private, else its private sibling when there is one.
 */
async function privateSeedFiles(seedsFilePath: string): Promise<string[]> {
  const privatePath = privatePathFor(seedsFilePath);
  return isPrivatePath(seedsFilePath) || (await fileExists(privatePath))
    ? [privatePath]
    : [];
}

// Written to the temp folder when seeds were rejected (see the end of
// `expandScenariosCommand`). Not a scenario file.
const rejectedMarker = "rejected.marker.json";

/** A seed left without a scenario, as written to the reject file. */
export interface RejectedSeed {
  seedId: string;
  riskId: string;
  /** "rejected": every attempt was rejected by the validation. "error": the
   * expansion failed (model error, placeholders left in the opening). */
  outcome: "rejected" | "error";
  /** The validator's reasons for the last rejection, or the error. */
  reasons: string;
  /** The seed as last tried, relabels included. */
  seed: ScenarioSeed;
}

/** Attempts per seed and model before the seed is relabeled, regenerated or
 * given up: V7.1 seeds needed 3.3 on average to pass, some up to 13. */
export const DEFAULT_EXPANSION_ATTEMPTS = 6;

/** `data/scenarios.jsonl` → `data/scenarios.seeds-regenerated.jsonl` (and
 * `.seeds-regenerated.private.jsonl`): the seeds `regenerateSeed` wrote again,
 * appended run after run. */
export function regeneratedPathsFor(outputFilePath: string): {
  public: string;
  private: string;
} {
  const {dir, name} = path.parse(outputFilePath);
  const base = name.replace(/\.private$/, "");
  return {
    public: path.join(dir, `${base}.seeds-regenerated.jsonl`),
    private: path.join(dir, `${base}.seeds-regenerated.private.jsonl`),
  };
}

/** `data/scenarios.jsonl` → `data/scenarios.rejected.jsonl`, and the private
 * seeds' rejects in `data/scenarios.rejected.private.jsonl`. */
export function rejectedPathsFor(outputFilePath: string): {
  public: string;
  private: string;
} {
  const {dir, name} = path.parse(outputFilePath);
  const base = name.replace(/\.private$/, "");
  return {
    public: path.join(dir, `${base}.rejected.jsonl`),
    private: path.join(dir, `${base}.rejected.private.jsonl`),
  };
}

async function writeRejected(
  paths: {public: string; private: string},
  rows: readonly RejectedSeed[],
  privateSeedIds: ReadonlySet<string>
): Promise<void> {
  const lines = (isPrivate: boolean) =>
    rows
      .filter(row => privateSeedIds.has(row.seedId) === isPrivate)
      .map(row => JSON.stringify(row) + "\n")
      .join("");
  await fs.writeFile(paths.public, lines(false));
  if (privateSeedIds.size > 0) {
    await fs.writeFile(paths.private, lines(true));
  }
}

/**
 * Write the corpus from the temp folder: every seed that has a scenario, in
 * input order, to the public or private output, and the rejected seeds to
 * their own files. The temp folder is left as it is.
 */
export async function writeExpansionOutputs(args: {
  ordered: readonly ScenarioSeed[];
  tempDir: string;
  outputFilePath: string;
  privateOutputFilePath: string;
  hasPrivateSeeds: boolean;
  privateSeedIds: ReadonlySet<string>;
  rejected: readonly RejectedSeed[];
}): Promise<{
  publicCount: number;
  privateCount: number;
  rejectedPaths: {public: string; private: string};
}> {
  const {ordered, tempDir, outputFilePath, privateOutputFilePath} = args;
  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  let publicCount = 0;
  let privateCount = 0;
  await fs.writeFile(outputFilePath, "");
  if (args.hasPrivateSeeds) {
    await fs.writeFile(privateOutputFilePath, "");
  }
  for (const seed of ordered) {
    const content = await fs
      .readFile(path.join(tempDir, `${seed.id}.json`), "utf-8")
      .catch(() => undefined);
    if (content === undefined) {
      continue;
    }
    const scenarios = JSON.parse(content) as Scenario[];
    for (const scenario of scenarios) {
      const isPrivate = args.privateSeedIds.has(scenario.seed.id);
      await fs.appendFile(
        isPrivate ? privateOutputFilePath : outputFilePath,
        JSON.stringify(scenario) + "\n"
      );
      if (isPrivate) {
        privateCount++;
      } else {
        publicCount++;
      }
    }
  }
  const rejectedPaths = rejectedPathsFor(outputFilePath);
  const position = new Map(ordered.map((seed, i) => [seed.id, i]));
  await writeRejected(
    rejectedPaths,
    R.sortBy([...args.rejected], row => position.get(row.seedId) ?? 0),
    args.privateSeedIds
  );
  return {publicCount, privateCount, rejectedPaths};
}

export interface ExpandScenariosOptions {
  /** Validate a rejected scenario a second time, and count it rejected only
   * when both verdicts fail (`validateConfirmed`). Default true. */
  recheck?: boolean;
  /** Attempts per seed and model (default `DEFAULT_EXPANSION_ATTEMPTS`). */
  maxAttempts?: number;
  /** Write a seed's text again in its slot when no scenario of it passed
   * (`regenerateSeed`). Default true. */
  regenerateSeeds?: boolean;
}

export async function expandScenariosCommand(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  seedsFilePath: string,
  outputFilePath: string,
  riskIds?: readonly string[],
  language?: string,
  options?: ExpandScenariosOptions
) {
  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  // With a child simulator, the opening is written by the child that writes
  // every later turn of a run (the profile's user model through the recipe),
  // not by `expansionUser`: one child per conversation.
  const childSimulator = roles.childSimulator
    ? MimesisPatch.recipeRef()
    : undefined;
  if (childSimulator && language && language !== "English") {
    throw new Error("MIMESIS patch supports English conversations only.");
  }
  console.log(
    `Expanding scenarios using ${chainLabel(roles.expansion)} (opening: ${
      childSimulator
        ? `${roles.user.name} through ${childSimulator.id}@${childSimulator.version}`
        : chainLabel(roles.expansionUser)
    })...`
  );
  const riskIdFilter = resolveRiskIdFilter(riskIds);
  // Private seeds expand into private scenarios: both stay out of the published
  // corpus, in files git ignores.
  const privateSeedPaths = await privateSeedFiles(seedsFilePath);
  const seedPaths = R.unique([seedsFilePath, ...privateSeedPaths]);
  const privateOutputFilePath = privatePathFor(outputFilePath);
  const seedCounts = await Promise.all(
    seedPaths.map(filePath => assertInputConforms(filePath, "seeds"))
  );
  console.log(
    `Validated ${R.sum(seedCounts)} seed(s) against taxonomy "${RiskTaxonomy.label(Packs.current().taxonomy)}".`
  );
  const privateSeedIds = new Set(
    await readSeedIds(privateSeedPaths, riskIdFilter)
  );
  if (privateSeedPaths.length > 0) {
    console.log(
      `Private seeds: ${privateSeedIds.size} from ${privateSeedPaths.join(", ")} → ${privateOutputFilePath} (git-ignored)`
    );
  }
  const stamp = await buildRunStamp({
    effective,
    modelsJsonPath,
    inputPath: seedsFilePath,
    language,
  });
  Stamp.configure(stamp);
  if (language) {
    console.log(`First user message language: ${language}.`);
  }
  if (riskIdFilter) {
    console.log(`Filtering to risk IDs: ${[...riskIdFilter].join(", ")}`);
  }

  // Expansion is wrapped in a task-level fallback chain: each seed tries the
  // primary model first, then advances to the next on either a thrown error
  // OR a ScenarioValidationError (the model returned valid JSON but the
  // content was rejected by the validator — e.g. truncated mid-sentence).
  // The per-call retry/fallback inside createGatewayModelChain only catches
  // thrown errors, so validation failures slip past it; rotating at the task
  // level fixes that.
  const expansionModels = roles.expansion.map(spec => ({
    label: spec.name,
    model: createSpecModel(spec),
  }));
  const userModel = createChainModel(roles.expansionUser).model;
  const getChildResponse = childSimulator
    ? createChildSimulator(createSpecModel(roles.user, {rejectTruncated: true}))
    : undefined;

  const outputDir = path.dirname(outputFilePath);
  const tempDir = path.join(outputDir, ".kora-expand-tmp");

  // Clear output file if no process in progress (no temp files)
  const fresh = !(await hasCachedFiles(tempDir));
  if (fresh) {
    await fs.mkdir(outputDir, {recursive: true});
    await fs.writeFile(outputFilePath, "");
    if (privateSeedPaths.length > 0) {
      await fs.writeFile(privateOutputFilePath, "");
    }
  }

  await fs.mkdir(tempDir, {recursive: true});
  await assertResumable(tempDir, stamp);

  // Every verdict of the validation step is recorded, including a rejection
  // followed by a retry that passes, so that the pass rate can be reported.
  const paths = validationPathsFor(outputFilePath);
  const ledger = await openLedger(paths.ledger, {fresh});
  // Rejections of earlier runs count toward the child-voice relaxation.
  const priorRows = (await readLedger(paths.ledger)).filter(
    row => row.stage === "expansion"
  );
  const priorRejections = standingRejections(priorRows);
  // Seeds an earlier run relabeled: each relabel is applied again, the same
  // way, before their chain starts.
  const priorRelabels = new Map<string, {signal: boolean; use: boolean}>();
  for (const row of priorRows) {
    const prior = priorRelabels.get(row.key) ?? {signal: false, use: false};
    priorRelabels.set(row.key, {
      signal:
        prior.signal ||
        row.relabeledFrom !== undefined ||
        row.relabeled?.riskSignalType !== undefined,
      use: prior.use || row.relabeled?.use !== undefined,
    });
  }
  const reportValidation = async () => {
    const report = buildPassRateReport({
      stage: "expansion",
      rows: await readLedger(paths.ledger),
    });
    await writePassRateReport(paths, report);
    console.log(`\n${formatPassRateReport(report)}`);
    console.log(
      `Report → ${paths.reportMd} (and .json); every verdict → ${paths.ledger}`
    );
  };

  const totalSeeds = (await readSeedIds(seedPaths, riskIdFilter)).length;
  const progress = Script.progress(totalSeeds, text =>
    process.stdout.write(text)
  );
  let failureCount = 0;
  let reusedCount = 0;
  // Seeds left without a scenario this run, written next to the output.
  const rejected: RejectedSeed[] = [];
  // Seeds whose text was written again this run (`regenerateSeed`).
  const regeneratedSeeds: ScenarioSeed[] = [];
  const seedWriter = createChainModel(roles.seeds).model;
  const seedChecker = createChainModel(roles.seedValidation).model;
  const seedContext: GenerateSeedsContext = {
    getResponse: async request => ({
      output: await seedWriter.getStructuredResponse(request),
    }),
    getValidationResponse: async request => ({
      output: await seedChecker.getStructuredResponse(request),
    }),
  };
  await consume(
    flatTransform(
      10,
      async (seed: ScenarioSeed) => {
        const tempFile = path.join(tempDir, `${seed.id}.json`);

        // Check if already processed (graceful restart).
        try {
          await fs.access(tempFile);
          reusedCount++;
          progress.increment(true);
          return [];
        } catch {
          // Not yet processed.
        }

        // A seed that stays stuck on the first-message signal type, or on a
        // use the mask forbids, is relabeled once per dimension
        // (`relabelSeed.ts`); a resumed run reads the relabels back from the
        // ledger and goes on with the same seed.
        const prior = priorRelabels.get(seed.id);
        let current: ScenarioSeed = seed;
        if (prior?.signal) current = relabelSignalType(current) ?? current;
        if (prior?.use) current = relabelUse(current) ?? current;
        let rejections = priorRejections[seed.id] ?? 0;

        // The chain of expansion models, each tried until it exhausts its
        // attempts. Resolves to the scenarios, or to the last validation
        // error with whether every model was stuck on the signal type.
        const expandWithChain = async (): Promise<
          | {scenarios: readonly Scenario[]}
          | {
              error: ScenarioValidationError;
              stuckOnSignalType: boolean;
              stuckOnUse: boolean;
            }
          | {thrown: unknown}
        > => {
          let stuckOnSignalType = true;
          let stuckOnUse = true;
          for (let i = 0; i < expansionModels.length; i++) {
            const {label, model} = expansionModels[i]!;
            const context: ExpandScenarioContext = {
              language,
              getResponse: async request => ({
                output: await model.getStructuredResponse(request),
              }),
              getUserResponse: async request => ({
                output: await userModel.getTextResponse(request),
              }),
              ...(getChildResponse ? {getChildResponse} : {}),
              onValidation: event => {
                // A rejection counts once it stands: a recheck that passes
                // takes the first verdict back.
                if (event.recheck) {
                  if (event.verdict === "pass") {
                    rejections--;
                  }
                } else if (event.verdict === "fail") {
                  rejections++;
                }
                return ledger.record({
                  stage: "expansion",
                  key: seed.id,
                  seedId: seed.id,
                  verdict: event.verdict,
                  questions: ScenarioValidation.questionsOf(event.validation),
                  reasons: event.reasons,
                  ...(event.childVoiceRelaxed ? {childVoiceRelaxed: true} : {}),
                  ...(event.firstMessageRewrite
                    ? {firstMessageRewrite: true}
                    : {}),
                  ...(event.recheck ? {recheck: true} : {}),
                  ...(current.relabeled ? {relabeled: current.relabeled} : {}),
                  // The expansion model validates its own output.
                  generatorModel: label,
                  validatorModel: label,
                  ...(event.verdict === "fail"
                    ? {
                        rejected: {
                          shortTitle: event.scenario.shortTitle,
                          narrative: event.scenario.narrative,
                          firstUserMessage: event.scenario.firstUserMessage,
                        },
                      }
                    : {}),
                  population: populationRowOf(
                    current,
                    privateSeedIds.has(seed.id)
                  ),
                });
              },
            };

            try {
              const scenarios = await kora.expandScenario(context, current, {
                priorRejections: rejections,
                recheck: options?.recheck,
                maxAttempts: options?.maxAttempts ?? DEFAULT_EXPANSION_ATTEMPTS,
              });
              return {scenarios};
            } catch (error) {
              const next = expansionModels[i + 1];
              const reason =
                error instanceof ScenarioValidationError
                  ? `validation failed (${error.lastReasons.slice(0, 200)})`
                  : `error (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`;
              if (error instanceof ScenarioValidationError) {
                stuckOnSignalType &&= error.stuckOnSignalType;
                stuckOnUse &&= error.stuckOnUse;
              }

              if (next) {
                console.error(
                  `[fallback] expandScenario on ${label} for seed ${seed.id}: ${reason}; trying ${next.label}`
                );
                continue;
              }

              // Last model exhausted.
              if (error instanceof ScenarioValidationError) {
                return {error, stuckOnSignalType, stuckOnUse};
              }
              // A thrown error (a model call that failed for good, a first
              // message that kept its placeholders) fails this seed for the
              // run, not the run: the next pass retries it.
              return {thrown: error};
            }
          }
          throw new Error("No expansion model configured.");
        };

        let outcome = await expandWithChain();
        if ("error" in outcome && outcome.stuckOnSignalType) {
          const relabeled = relabelSignalType(current);
          if (relabeled) {
            console.error(
              `\n[relabel] seed ${seed.id}: every attempt rejected the first user message on the risk signal type; ${current.riskSignalType} → ${relabeled.riskSignalType}, trying again`
            );
            current = relabeled;
            outcome = await expandWithChain();
          }
        }
        if ("error" in outcome && outcome.stuckOnUse) {
          const relabeled = relabelUse(current);
          if (relabeled) {
            console.error(
              `\n[relabel] seed ${seed.id}: every attempt rejected the scenario on a use its situation type forbids; ${current.use} → ${relabeled.use}, trying again`
            );
            current = relabeled;
            outcome = await expandWithChain();
          }
        }

        // Last step before giving the seed up: its text written again in its
        // slot, every assigned value kept, then one more pass of the chain.
        if ("error" in outcome && options?.regenerateSeeds !== false) {
          const regenerated = await regenerateSeed(
            seedContext,
            current,
            outcome.error.lastReasons
              .split(" | ")
              .filter(reason => reason.length > 0),
            {isPrivate: privateSeedIds.has(seed.id)}
          ).catch((error: unknown) => {
            console.error(
              `\n[regenerate] seed ${seed.id}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`
            );
            return undefined;
          });
          if (regenerated) {
            console.error(
              `\n[regenerate] seed ${seed.id}: no scenario passed; its text was written again in its slot, trying again`
            );
            current = regenerated;
            regeneratedSeeds.push(regenerated);
            outcome = await expandWithChain();
          }
        }

        if ("scenarios" in outcome) {
          await fs.writeFile(
            tempFile,
            JSON.stringify(outcome.scenarios, null, 2)
          );
          progress.increment(true);
          return [];
        }
        if ("thrown" in outcome) {
          const message =
            outcome.thrown instanceof Error
              ? outcome.thrown.message
              : String(outcome.thrown);
          console.error(
            `\nExpansion failed for seed ${seed.id} (all models exhausted): ${message.slice(0, 300)}`
          );
          rejected.push({
            seedId: seed.id,
            riskId: seed.riskId,
            outcome: "error",
            reasons: message,
            seed: current,
          });
        } else {
          console.error(
            `\nValidation failed for seed ${seed.id} (all models exhausted): ${outcome.error.lastReasons}`
          );
          rejected.push({
            seedId: seed.id,
            riskId: seed.riskId,
            outcome: "rejected",
            reasons: outcome.error.lastReasons,
            seed: current,
          });
        }
        failureCount++;
        progress.increment(false);
        return [];
      },
      readSeedsFromFiles(seedPaths, riskIdFilter)
    )
  );

  progress.finish();
  await reportValidation();

  // The output holds every seed that has a scenario, in input order, whether
  // or not other seeds were rejected: a rejected seed does not hold back the
  // corpus. Rejected seeds go to their own file, with the reasons; the temp
  // folder is kept so that a re-run tries only them.
  const ordered: ScenarioSeed[] = [];
  for await (const seed of readSeedsFromFiles(seedPaths, riskIdFilter)) {
    ordered.push(seed);
  }
  const {publicCount, privateCount, rejectedPaths} =
    await writeExpansionOutputs({
      ordered,
      tempDir,
      outputFilePath,
      privateOutputFilePath,
      hasPrivateSeeds: privateSeedPaths.length > 0,
      privateSeedIds,
      rejected,
    });
  if (regeneratedSeeds.length > 0) {
    const regeneratedPaths = regeneratedPathsFor(outputFilePath);
    const lines = (isPrivate: boolean) =>
      regeneratedSeeds
        .filter(s => privateSeedIds.has(s.id) === isPrivate)
        .map(s => JSON.stringify(s) + "\n")
        .join("");
    await fs.appendFile(regeneratedPaths.public, lines(false));
    if (privateSeedIds.size > 0) {
      await fs.appendFile(regeneratedPaths.private, lines(true));
    }
    console.log(
      `\n${regeneratedSeeds.length} seed(s) written again in their slot → ${regeneratedPaths.public}${privateSeedIds.size > 0 ? ` and ${regeneratedPaths.private}` : ""}. The seeds file is not changed: the scenarios carry the new seed.`
    );
  }
  if (failureCount > 0) {
    // Marks the temp folder as a run in progress even when no seed passed,
    // so that the next run resumes (ledger and relabels kept) instead of
    // starting over.
    await fs.writeFile(
      path.join(tempDir, rejectedMarker),
      JSON.stringify(rejected.map(row => row.seedId)) + "\n"
    );
  } else {
    await fs.rm(tempDir, {recursive: true, force: true});
  }

  console.log(
    privateOutputFilePath === outputFilePath || privateCount === 0
      ? `\nExpanded ${publicCount + privateCount} scenarios → ${outputFilePath}`
      : `\nExpanded ${publicCount} public scenarios → ${outputFilePath}\n` +
          `Expanded ${privateCount} private scenarios → ${privateOutputFilePath}`
  );
  if (failureCount > 0) {
    console.log(
      `\n${failureCount} seed(s) have no scenario: ${rejectedPaths.public}${privateSeedIds.size > 0 ? ` (private seeds: ${rejectedPaths.private})` : ""}, with the reasons. Temp files kept at ${tempDir}: re-run the same command to try only them.`
    );
    process.exitCode = 1;
  }
  return workSummary(
    "seed",
    totalSeeds,
    totalSeeds - failureCount,
    failureCount,
    reusedCount
  );
}
