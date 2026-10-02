import {
  AgeRange,
  DEFAULT_PRIVATE_RATIO,
  DEFAULT_TOTAL_SEEDS,
  GenerateSeedsContext,
  GenerateSeedsOptions,
  kora,
  Motivation,
  PopulationDistribution,
  privateCount as privateCountFor,
  RefusalBehavior,
  RiskCategory,
  RiskSignalType,
  SeedUse,
  SocialContext,
  Stamp,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {Program} from "../cli.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
  RoleOverrides,
} from "../profiles/effectiveProfile.js";
import {chainLabel, createChainModel} from "../profiles/roleModels.js";
import {buildRunStamp} from "../stamp/buildRunStamp.js";
import {privatePathFor} from "./shared/privatePath.js";

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
  Stamp.configure(await buildRunStamp({effective, modelsJsonPath}));
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
    "  Exact age: even within each band. Memory: from the risk definition."
  );
  if (options?.randomSeed !== undefined) {
    console.log(`  Random seed: ${options.randomSeed}`);
  }
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

  const {model} = createChainModel(roles.seeds);

  const context: GenerateSeedsContext = {
    getResponse: async request => ({
      output: await model.getStructuredResponse(request),
    }),
  };

  await fs.mkdir(path.dirname(outputFilePath), {recursive: true});
  await fs.writeFile(outputFilePath, ""); // Clear file before starting
  if (privateRatio > 0) {
    await fs.writeFile(privateFilePath, "");
  } else if (await fileExists(privateFilePath)) {
    console.warn(
      `Warning: ${privateFilePath} is left over from an earlier generation and no longer matches ${outputFilePath}; expand-scenarios would still pick it up. Delete it if it is stale.`
    );
  }

  const generator = kora.generateScenarioSeeds(context, options);
  const first = await generator.next();
  if (first.done) {
    console.log("\nNo seeds to generate.");
    return;
  }

  const progress = Script.progress(first.value.total, text =>
    process.stdout.write(text)
  );
  let publicCount = 0;
  let privateCount = 0;

  for await (const event of generator) {
    const filePath = event.private ? privateFilePath : outputFilePath;
    for (const seed of event.items) {
      await fs.appendFile(filePath, JSON.stringify(seed) + "\n");
      if (event.private) {
        privateCount++;
      } else {
        publicCount++;
      }
      progress.increment(true);
    }
  }

  progress.finish();
  console.log(
    privateFilePath === outputFilePath || privateCount === 0
      ? `\nGenerated ${publicCount + privateCount} seeds → ${outputFilePath}`
      : `\nGenerated ${publicCount} public seeds → ${outputFilePath}\n` +
          `Generated ${privateCount} private seeds → ${privateFilePath}`
  );
}
