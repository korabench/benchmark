import {
  ExpandScenarioContext,
  kora,
  Packs,
  relabelSignalType,
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
import {
  assertResumable,
  hasCachedFiles,
  listCachedFiles,
} from "./shared/cacheStamp.js";
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

export async function expandScenariosCommand(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  seedsFilePath: string,
  outputFilePath: string,
  riskIds?: readonly string[],
  language?: string
) {
  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  console.log(
    `Expanding scenarios using ${chainLabel(roles.expansion)} (user: ${chainLabel(roles.expansionUser)})...`
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
  const priorRejections = R.countBy(
    priorRows.filter(row => row.verdict === "fail"),
    row => row.key
  );
  // Seeds an earlier run relabeled: the relabel is applied again, the same
  // way, before their chain starts.
  const priorRelabels = new Set(
    priorRows.filter(row => row.relabeledFrom).map(row => row.key)
  );
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
  await consume(
    flatTransform(
      10,
      async (seed: ScenarioSeed) => {
        const tempFile = path.join(tempDir, `${seed.id}.json`);

        // Check if already processed (graceful restart).
        try {
          await fs.access(tempFile);
          progress.increment(true);
          return [];
        } catch {
          // Not yet processed.
        }

        // A seed that stays stuck on the first-message signal type is
        // relabeled once (`relabelSignalType`); a resumed run reads the
        // relabel back from the ledger and goes on with the same seed.
        let current: ScenarioSeed = priorRelabels.has(seed.id)
          ? (relabelSignalType(seed) ?? seed)
          : seed;
        let rejections = priorRejections[seed.id] ?? 0;

        // The chain of expansion models, each tried until it exhausts its
        // attempts. Resolves to the scenarios, or to the last validation
        // error with whether every model was stuck on the signal type.
        const expandWithChain = async (): Promise<
          | {scenarios: readonly Scenario[]}
          | {error: ScenarioValidationError; stuckOnSignalType: boolean}
        > => {
          let stuckOnSignalType = true;
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
              onValidation: event => {
                if (event.verdict === "fail") {
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
                  ...(current.relabeled
                    ? {relabeledFrom: current.relabeled.riskSignalType.from}
                    : {}),
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
              });
              return {scenarios};
            } catch (error) {
              const next = expansionModels[i + 1];
              const reason =
                error instanceof ScenarioValidationError
                  ? `validation failed (${error.lastReasons.slice(0, 200)})`
                  : `error (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`;
              if (
                error instanceof ScenarioValidationError &&
                !error.stuckOnSignalType
              ) {
                stuckOnSignalType = false;
              }

              if (next) {
                console.error(
                  `[fallback] expandScenario on ${label} for seed ${seed.id}: ${reason}; trying ${next.label}`
                );
                continue;
              }

              // Last model exhausted.
              if (error instanceof ScenarioValidationError) {
                return {error, stuckOnSignalType};
              }
              throw error;
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

        if ("scenarios" in outcome) {
          await fs.writeFile(
            tempFile,
            JSON.stringify(outcome.scenarios, null, 2)
          );
          progress.increment(true);
          return [];
        }
        console.error(
          `\nValidation failed for seed ${seed.id} (all models exhausted): ${outcome.error.lastReasons}`
        );
        failureCount++;
        progress.increment(false);
        return [];
      },
      readSeedsFromFiles(seedPaths, riskIdFilter)
    )
  );

  progress.finish();
  await reportValidation();

  if (failureCount > 0) {
    console.log(
      `\n${failureCount} seeds failed validation. Temp files kept at ${tempDir} for restart.`
    );
    console.log(`Re-run the command to retry failed seeds.`);
    return;
  }

  // Build final output from temp files.
  await fs.mkdir(outputDir, {recursive: true});
  const tempFiles = await listCachedFiles(tempDir);
  let publicCount = 0;
  let privateCount = 0;

  await fs.writeFile(outputFilePath, "");
  if (privateSeedPaths.length > 0) {
    await fs.writeFile(privateOutputFilePath, "");
  }
  for (const file of tempFiles) {
    const content = await fs.readFile(path.join(tempDir, file), "utf-8");
    const scenarios = JSON.parse(content) as Scenario[];
    for (const scenario of scenarios) {
      const isPrivate = privateSeedIds.has(scenario.seed.id);
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

  await fs.rm(tempDir, {recursive: true, force: true});

  console.log(
    privateOutputFilePath === outputFilePath || privateCount === 0
      ? `\nExpanded ${publicCount + privateCount} scenarios → ${outputFilePath}`
      : `\nExpanded ${publicCount} public scenarios → ${outputFilePath}\n` +
          `Expanded ${privateCount} private scenarios → ${privateOutputFilePath}`
  );
}
