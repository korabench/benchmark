import {
  AgeRange,
  DEFAULT_PRIVATE_RATIO,
  DEFAULT_SEED_VALIDATION_ATTEMPTS,
  DEFAULT_TOTAL_SEEDS,
  GenerateSeedsContext,
  GenerateSeedsOptions,
  kora,
  Motivation,
  planSeedSlots,
  PopulationDistribution,
  privateCount as privateCountFor,
  RefusalBehavior,
  RiskCategory,
  RiskSignalType,
  SeedSlot,
  SeedUse,
  SeedValidation,
  SocialContext,
  Stamp,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import {randomInt} from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as R from "remeda";
import * as v from "valibot";
import {Program} from "../cli.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
  RoleOverrides,
} from "../profiles/effectiveProfile.js";
import {chainLabel, createChainModel} from "../profiles/roleModels.js";
import {buildRunStamp} from "../stamp/buildRunStamp.js";
import {assertResumable, listCachedFiles} from "./shared/cacheStamp.js";
import {
  buildPassRateReport,
  formatPassRateReport,
  writePassRateReport,
} from "./shared/passRateReport.js";
import {privatePathFor} from "./shared/privatePath.js";
import {
  openLedger,
  populationRowOf,
  readLedger,
  validationPathsFor,
} from "./shared/validationLedger.js";

/**
 * Per-value count of a proportional dimension: "20" when exact, "18-19" when
 * the rounding remainder lands on a random value in each risk.
 */
function formatProportional(
  proportions: Record<string, number>,
  total: number
): string {
  return Object.entries(proportions)
    .map(([k, p]) => {
      const exact = p * total;
      const floor = Math.floor(exact);
      return `${k}:${exact === floor ? floor : `${floor}-${floor + 1}`}`;
    })
    .join("/");
}

/** Per-value count of an evenly allocated dimension: "10" or "4-5". */
function formatEven(total: number, valueCount: number): string {
  const base = Math.floor(total / valueCount);
  return total % valueCount === 0 ? `${base}` : `${base}-${base + 1}`;
}

const TEMP_DIR = ".kora-seeds-tmp";
const PLAN_FILE = "plan.json";

const VSeedPlan = v.object({
  randomSeed: v.number(),
  planHash: v.string(),
  /** Base name of the output file the cached seeds are for. */
  output: v.string(),
});

function slotFile(key: string): string {
  return `${key}.json`;
}

/** Keys of the slots already filled in `tempDir`. */
async function readCachedKeys(tempDir: string): Promise<ReadonlySet<string>> {
  const files = await listCachedFiles(tempDir);
  return new Set(
    files
      .filter(file => file !== PLAN_FILE && file.endsWith(".json"))
      .map(file => file.slice(0, -".json".length))
  );
}

async function readPlan(
  tempDir: string
): Promise<v.InferOutput<typeof VSeedPlan>> {
  const planPath = path.join(tempDir, PLAN_FILE);
  const raw = await fs.readFile(planPath, "utf-8").catch(() => {
    throw new Error(
      `${tempDir} holds seeds but no ${PLAN_FILE}: it cannot be resumed. Delete it to start over.`
    );
  });
  return v.parse(VSeedPlan, JSON.parse(raw));
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

export async function generateSeeds(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  outputFilePath: string,
  options?: GenerateSeedsOptions
) {
  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  const stamp = await buildRunStamp({effective, modelsJsonPath});
  Stamp.configure(stamp);

  // Filled slots are kept in a temp directory until every slot has a seed, so
  // that a run with rejected or failed slots resumes instead of starting over.
  // Resuming needs the same plan, hence the same random seed.
  const tempDir = path.join(path.dirname(outputFilePath), TEMP_DIR);
  const cachedKeys = await readCachedKeys(tempDir);
  const plan = cachedKeys.size > 0 ? await readPlan(tempDir) : undefined;
  if (
    plan &&
    options?.randomSeed !== undefined &&
    options.randomSeed !== plan.randomSeed
  ) {
    throw new Error(
      `Refusing to resume ${tempDir}: it was started with --random-seed ${plan.randomSeed}, not ${options.randomSeed}.\n` +
        `Delete ${tempDir} to start over, or re-run with the same seed.`
    );
  }
  if (plan && plan.output !== path.basename(outputFilePath)) {
    throw new Error(
      `Refusing to resume ${tempDir}: it holds the seeds of ${plan.output}, not ${path.basename(outputFilePath)}.\n` +
        `Delete ${tempDir} to start over, or write to another directory.`
    );
  }
  const randomSeed =
    options?.randomSeed ?? plan?.randomSeed ?? randomInt(2 ** 32);
  const planOptions: GenerateSeedsOptions = {...options, randomSeed};
  console.log(
    roles.seeds.length === 1
      ? `Generating seeds using ${chainLabel(roles.seeds)}...`
      : `Generating seeds with fallback chain: ${chainLabel(roles.seeds)}`
  );
  if (options?.riskIds?.length) {
    console.log(`Filtering to risk IDs: ${options.riskIds.join(", ")}`);
  }
  if (options?.motivations?.length) {
    console.log(`Filtering to motivations: ${options.motivations.join(", ")}`);
  }
  // Mirror of what `kora.generateScenarioSeeds` allocates, printed up front so
  // the shape of the run is visible before any model call is made.
  const d = options?.distribution ?? PopulationDistribution.default();
  const n = options?.totalSeeds ?? DEFAULT_TOTAL_SEEDS;
  const motivationCount =
    options?.motivations?.length ?? Motivation.listAll().length;
  const ageRanges = options?.ageRanges ?? AgeRange.list;
  console.log(`Population distribution: ${d.name}`);
  console.log(
    `  Per-risk allocation at totalSeeds=${n}: ` +
      (ageRanges.length === AgeRange.list.length
        ? `age=${formatProportional(d.ageRange, n)}`
        : `age=renormalized over ${ageRanges.join(",")}`) +
      ` | gender=${formatProportional(d.gender, n)}` +
      ` | ses=${formatProportional(d.ses, n)}` +
      ` | race=${formatProportional(d.raceEthnicity, n)}`
  );
  console.log(
    `  Evenly allocated per risk (seeds per value): ` +
      `motivation=${formatEven(n, motivationCount)}` +
      ` | socialContext=${formatEven(n, SocialContext.list.length)}` +
      ` | riskSignalType=${formatEven(n, RiskSignalType.list.length)}` +
      ` | use=${formatEven(n, SeedUse.list.length)}` +
      ` | refusalBehavior=${formatEven(n, RefusalBehavior.list.length)}`
  );
  console.log(
    "  Risk signal type: never one the seed's situation type forbids (situation mask); a risk with too few situation types that allow a value gets fewer seeds of it."
  );
  console.log(
    "  Exact age: even within each band. Memory: from the risk definition."
  );
  console.log(
    `  Random seed: ${randomSeed}${options?.randomSeed === undefined ? (plan ? " (from the run being resumed)" : " (drawn for this run; pass --random-seed to reproduce it)") : ""}`
  );
  const privateRatio = options?.privateRatio ?? DEFAULT_PRIVATE_RATIO;
  const privateFilePath = privatePathFor(outputFilePath);
  console.log(
    "  Situation type: even across each gold standard's types within each age band (drift types excluded)."
  );
  console.log(
    privateRatio > 0
      ? `  Private split: ${privateCountFor(n, privateRatio)} of ${n} seeds per risk, spread over its situation types → ${privateFilePath} (git-ignored)`
      : "  Private split: none, every seed is public."
  );

  const riskIdSet = options?.riskIds ? new Set(options.riskIds) : undefined;
  const flavoredRisks = RiskCategory.listAll()
    .flatMap(c => c.risks)
    .filter(r => r.scenarioFlavors?.length)
    .filter(r => !riskIdSet || riskIdSet.has(r.id));
  for (const risk of flavoredRisks) {
    const proportions = Object.fromEntries(
      risk.scenarioFlavors!.map(f => [f.id, f.proportion])
    );
    console.log(
      `  Flavor allocation for ${risk.id}: ${formatProportional(proportions, n)}`
    );
  }

  // A slot the check rejected is written again by the next model of the
  // chain: one that sanitises a risk away tends to do it again when asked to
  // rewrite. Each rotation is still a fallback chain over the other models.
  const rotations = roles.seeds.map((_, start) => {
    const specs = [...roles.seeds.slice(start), ...roles.seeds.slice(0, start)];
    return {label: chainLabel(specs), model: createChainModel(specs).model};
  });
  const rotationFor = (rejections: number) =>
    rotations[rejections % rotations.length]!;
  const validator = createChainModel(roles.seedValidation).model;
  const validatorLabel = chainLabel(roles.seedValidation);
  console.log(
    `Checking every seed with ${validatorLabel}: a rejected seed is written again for the same slot, up to ${DEFAULT_SEED_VALIDATION_ATTEMPTS} times per run${rotations.length > 1 ? ", each time by the next model of the chain" : ""}.`
  );
  if (roles.seeds[0]!.model === roles.seedValidation[0]!.model) {
    console.warn(
      `Warning: the seeds and seedValidation roles both start with ${roles.seeds[0]!.model}: the model checks its own seeds.`
    );
  }

  // The plan is computed here as well as inside `kora.generateScenarioSeeds`:
  // the command needs every slot to know which are filled and to write the
  // seeds in plan order.
  const slots = planSeedSlots(planOptions);
  const planHash = SeedSlot.planHash(slots);
  if (plan && plan.planHash !== planHash) {
    throw new Error(
      `Refusing to resume ${tempDir}: it holds seeds of a different plan (other --total-seeds, --risk-ids, --distribution or similar).\n` +
        `Delete ${tempDir} to start over, or re-run with the options of the first run.`
    );
  }

  const fresh = cachedKeys.size === 0;
  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  if (fresh) {
    await fs.writeFile(outputFilePath, ""); // Clear file before starting
    if (privateRatio > 0) {
      await fs.writeFile(privateFilePath, "");
    }
  }
  if (privateRatio === 0 && (await fileExists(privateFilePath))) {
    console.warn(
      `Warning: ${privateFilePath} is left over from an earlier generation and no longer matches ${outputFilePath}; expand-scenarios would still pick it up. Delete it if it is stale.`
    );
  }
  await fs.mkdir(tempDir, {recursive: true});
  await assertResumable(tempDir, stamp);
  await fs.writeFile(
    path.join(tempDir, PLAN_FILE),
    JSON.stringify(
      {randomSeed, planHash, output: path.basename(outputFilePath)},
      null,
      2
    )
  );

  const paths = validationPathsFor(outputFilePath);
  const ledger = await openLedger(paths.ledger, {fresh});
  // Rejections of earlier runs count: a resumed slot goes on down the chain.
  const priorRejections = R.countBy(
    (await readLedger(paths.ledger)).filter(
      row => row.stage === "seed" && row.verdict === "fail"
    ),
    row => row.key
  );

  const context: GenerateSeedsContext = {
    getResponse: async (request, info) => ({
      output: await rotationFor(
        info?.rejections ?? 0
      ).model.getStructuredResponse(request),
    }),
    getValidationResponse: async request => ({
      output: await validator.getStructuredResponse(request),
    }),
    onValidation: async event => {
      const {seed} = event;
      await ledger.record({
        stage: "seed",
        key: event.key,
        seedId: seed.id,
        verdict: event.verdict,
        questions: event.validation,
        generatorModel: rotationFor(event.rejections).label,
        validatorModel: validatorLabel,
        ...(event.verdict === "fail"
          ? {
              rejected: {
                shortTitle: seed.shortTitle,
                coreBehavior: seed.coreBehavior,
                context: seed.context,
                notes: seed.notes,
              },
            }
          : {}),
        population: populationRowOf(seed, event.isPrivate),
      });
      if (event.verdict === "fail") {
        console.error(
          `\n[seed check] ${event.key} rejected (attempt ${event.attempt}/${event.maxAttempts}): ${SeedValidation.failedReasons(event.validation).join(" | ").slice(0, 300)}`
        );
      }
    },
  };

  const pendingCount = slots.filter(slot => !cachedKeys.has(slot.key)).length;
  if (!fresh) {
    console.log(
      `Resuming from ${tempDir}: ${slots.length - pendingCount} of ${slots.length} slots already filled.`
    );
  }
  const progress = Script.progress(slots.length, text =>
    process.stdout.write(text)
  );
  R.times(slots.length - pendingCount, () => progress.increment(true));

  const generator = kora.generateScenarioSeeds(context, {
    ...planOptions,
    skipSlotKeys: cachedKeys,
    priorRejections,
  });
  const filledKeys = new Set(cachedKeys);
  for await (const event of generator) {
    for (const seed of event.items) {
      if (event.key === undefined) {
        throw new Error(`Seed ${seed.id} was generated without a slot key.`);
      }
      await fs.writeFile(
        path.join(tempDir, slotFile(event.key)),
        JSON.stringify(seed)
      );
      filledKeys.add(event.key);
      progress.increment(true);
    }
  }
  const stuckSlots = slots.filter(slot => !filledKeys.has(slot.key));
  R.times(stuckSlots.length, () => progress.increment(false));
  progress.finish();

  const report = buildPassRateReport({
    stage: "seed",
    rows: await readLedger(paths.ledger),
  });
  await writePassRateReport(paths, report);
  console.log(`\n${formatPassRateReport(report)}`);
  console.log(
    `Report → ${paths.reportMd} (and .json); every verdict → ${paths.ledger}`
  );

  if (stuckSlots.length > 0) {
    console.error(
      `\n${stuckSlots.length} of ${slots.length} slots have no accepted seed. No seeds file was written; filled slots are kept in ${tempDir}.`
    );
    console.error(
      "Re-run the same command to retry only these slots. A slot that never passes points at an assignment no plausible seed can be written for."
    );
    process.exitCode = 1;
    return;
  }

  // Written in plan order, so that the files do not depend on which call
  // returned first.
  const seeds = await Promise.all(
    slots.map(async slot => ({
      isPrivate: slot.isPrivate,
      line: await fs.readFile(path.join(tempDir, slotFile(slot.key)), "utf-8"),
    }))
  );
  const [privateSeeds, publicSeeds] = R.partition(
    seeds,
    seed => seed.isPrivate
  );
  const toJsonl = (items: typeof seeds) =>
    items.map(item => item.line.trim() + "\n").join("");
  if (privateFilePath === outputFilePath) {
    await fs.writeFile(outputFilePath, toJsonl(seeds));
  } else {
    await fs.writeFile(outputFilePath, toJsonl(publicSeeds));
    if (privateSeeds.length > 0 || privateRatio > 0) {
      await fs.writeFile(privateFilePath, toJsonl(privateSeeds));
    }
  }
  await fs.rm(tempDir, {recursive: true, force: true});

  const publicCount = publicSeeds.length;
  const privateCount = privateSeeds.length;
  console.log(
    privateFilePath === outputFilePath || privateCount === 0
      ? `\nGenerated ${publicCount + privateCount} seeds → ${outputFilePath}`
      : `\nGenerated ${publicCount} public seeds → ${outputFilePath}\n` +
          `Generated ${privateCount} private seeds → ${privateFilePath}`
  );
}
