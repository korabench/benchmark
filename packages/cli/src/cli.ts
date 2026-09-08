#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import {
  AgeRange,
  PopulationDistribution,
  ScenarioPrompt,
} from "@korabench/benchmark";
import {existsSync} from "node:fs";
import * as path from "node:path";
import * as v from "valibot";
import {compareAssessmentsCommand} from "./commands/compareAssessmentsCommand.js";
import {continueCommand} from "./commands/continueCommand.js";
import {expandScenariosCommand} from "./commands/expandScenariosCommand.js";
import {generateSeeds} from "./commands/generateSeedsCommand.js";
import {profileCommand} from "./commands/profileCommand.js";
import {reassessCommand} from "./commands/reassessCommand.js";
import {runCommand} from "./commands/runCommand.js";
import {InputKind} from "./commands/shared/validateInputFile.js";
import {statsCommand} from "./commands/statsCommand.js";
import {validateCommand} from "./commands/validateCommand.js";
import {configurePacks} from "./packs/loadPack.js";
import {loadProfile, profilesDir} from "./profiles/loadProfile.js";
import {Profiles} from "./profiles/profiles.js";
import {readPackageVersion} from "./shared/packageVersion.js";

function findConfigFile(filename: string): string {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${filename} in ${process.cwd()} or any parent directory.`
      );
    }
    dir = parent;
  }
}

function splitCsv(value: string): readonly string[] {
  const parts = value
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (parts.length === 0) {
    throw new Error(
      `Expected a non-empty comma-separated list, got: "${value}"`
    );
  }
  return parts;
}

/** `splitCsv` for optional role arguments: absent means "from profile". */
function optionalCsv(value: string | undefined): readonly string[] | undefined {
  return value === undefined ? undefined : splitCsv(value);
}

const modelsJsonPath = findConfigFile("models.json");
const dataPath = path.join(path.dirname(modelsJsonPath), "data");

const defaultSeedsPath = path.relative(
  process.cwd(),
  path.join(dataPath, "scenarioSeeds.jsonl")
);
const defaultScenariosPath = path.relative(
  process.cwd(),
  path.join(dataPath, "scenarios.jsonl")
);
const defaultResultsPath = path.relative(
  process.cwd(),
  path.join(dataPath, "results.json")
);
const defaultReassessInputPath = path.relative(
  process.cwd(),
  path.join(dataPath, "reassessment-input.jsonl")
);
const defaultReassessOutputDir = path.relative(
  process.cwd(),
  path.join(dataPath, "reassessment-results")
);
const defaultContinueOutputDir = path.relative(
  process.cwd(),
  path.join(dataPath, "continue-results")
);
const defaultCompareOriginalPath = path.relative(
  process.cwd(),
  path.join(dataPath, "reassessment-input.assessments.json")
);
const defaultCompareNewPath = path.relative(
  process.cwd(),
  path.join(dataPath, "reassessment-results", "assessments.json")
);

const program = new Command()
  .addHelpText(
    "before",
    `
░█░█░█▀█░█▀▄░█▀█
░█▀▄░█░█░█▀▄░█▀█
░▀░▀░▀▀▀░▀░▀░▀░▀
`
  )
  .name("kora")
  .description("CLI tool to run the KORA benchmark.")
  .version(readPackageVersion(), "-v, --version")
  .option("-d, --debug", "print full errors and debug information")
  .option(
    "--taxonomy <name|path>",
    'risk taxonomy pack: a registered name ("kora") or a path to a JSON file holding a full {id, version, categories} taxonomy',
    process.env.KORA_TAXONOMY
  )
  .option(
    "--behaviors <name|path>",
    'behavior (mechanism) pack: a registered name ("kora") or a path to a JSON file holding a full {id, version, behaviors} set',
    process.env.KORA_BEHAVIORS
  )
  .option(
    "--profile <name|path>",
    'evaluation profile pinning the model for every role: a name under profiles/ ("kora"), a local scratch profile ("<name>.local"), or a path to a JSON file',
    process.env.KORA_PROFILE ?? "kora"
  );

// Packs and the profile must be resolved before any command body runs, but
// AFTER the module graph is fully loaded — `cli.ts` statically imports every
// command, so nothing may read a pack-dependent schema at module scope. See
// `benchmark.ts`. The `profile` command loads the profile itself so that
// `--print-hash` can inspect a file whose hash is stale.
program.hook("preAction", (_thisCommand, actionCommand) => {
  configurePacks({
    taxonomy: program.opts().taxonomy,
    behaviors: program.opts().behaviors,
  });
  if (actionCommand.name() !== "profile") {
    Profiles.configure(
      loadProfile(program.opts().profile, profilesDir(modelsJsonPath))
    );
  }
});

export type Program = typeof program;

program
  .command("generate-seeds")
  .description("generate a new set of scenario seeds")
  .argument(
    "[model]",
    "override the profile's seeds role with models.json slug(s); comma-separated for per-task fallback chain (e.g. gpt-4o,gpt-5.5:low)"
  )
  .option("-o, --output <path>", "output seeds JSONL file", defaultSeedsPath)
  .option(
    "--seeds-per-task <count>",
    "number of seeds to generate per risk/age/motivation combination (default: 8, ignored when --total-seeds is set)"
  )
  .option(
    "--total-seeds <count>",
    "total seeds to generate per risk, sampled across age/motivation combos (1 seed each; mutually exclusive with --seeds-per-task)"
  )
  .option(
    "--age-ranges <ranges>",
    "comma-separated age ranges to generate seeds for (7to9, 10to12, 13to17)",
    AgeRange.list.join(",")
  )
  .option(
    "--risk-ids <ids>",
    "comma-separated risk IDs to restrict generation to (defaults to all risks)"
  )
  .option(
    "--motivations <names>",
    "comma-separated motivation names to restrict generation to (defaults to all motivations)"
  )
  .option(
    "--distribution <preset-or-path>",
    `population-distribution preset (one of: ${PopulationDistribution.presetNames().join(", ")}) or path to a JSON file; when set, demographic fields (age band, gender, SES, race) are pre-allocated to match the target marginals. Requires --total-seeds.`
  )
  .option(
    "--random-seed <int>",
    "RNG seed for reproducible demographic allocation (distribution mode only)"
  )
  .action(async (model, opts) => {
    const distribution = opts.distribution
      ? await PopulationDistribution.resolve(opts.distribution)
      : undefined;
    const randomSeed =
      opts.randomSeed !== undefined ? parseInt(opts.randomSeed, 10) : undefined;
    if (opts.randomSeed !== undefined && !Number.isFinite(randomSeed)) {
      throw new Error(
        `--random-seed must be an integer (got: ${opts.randomSeed})`
      );
    }

    return generateSeeds(
      program,
      modelsJsonPath,
      {seeds: optionalCsv(model)},
      opts.output,
      {
        seedsPerTask:
          opts.seedsPerTask !== undefined
            ? parseInt(opts.seedsPerTask, 10)
            : undefined,
        totalSeeds:
          opts.totalSeeds !== undefined
            ? parseInt(opts.totalSeeds, 10)
            : undefined,
        ageRanges: opts.ageRanges
          .split(",")
          .map(r => v.parse(AgeRange.io, r.trim())),
        riskIds: opts.riskIds
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        motivations: opts.motivations
          ?.split(",")
          .map(name => name.trim())
          .filter(name => name.length > 0),
        distribution,
        randomSeed,
      }
    );
  });

program
  .command("expand-scenarios")
  .description("transform the seeds into fully fleshed out scenarios")
  .argument(
    "[model]",
    "override the profile's expansion role with models.json slug(s); comma-separated for per-task fallback chain"
  )
  .argument(
    "[user-model]",
    "override the profile's expansionUser role with models.json slug(s); comma-separated for per-task fallback chain"
  )
  .option("-i, --input <path>", "input seeds JSONL file", defaultSeedsPath)
  .option(
    "-o, --output <path>",
    "output scenarios JSONL file",
    defaultScenariosPath
  )
  .option(
    "--risk-ids <ids>",
    "comma-separated risk IDs to restrict expansion to (defaults to all seeds in the input file)"
  )
  .option(
    "--language <name>",
    'natural language the simulated child writes in, e.g. "Estonian" (default: English)'
  )
  .action((model, userModel, opts) =>
    expandScenariosCommand(
      program,
      modelsJsonPath,
      {expansion: optionalCsv(model), expansionUser: optionalCsv(userModel)},
      opts.input,
      opts.output,
      opts.riskIds
        ?.split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0),
      opts.language
    )
  );

program
  .command("run")
  .description("run the benchmark with the provided scenarios")
  .argument("<target-model>", "model to benchmark")
  .argument(
    "[user-model]",
    "override the profile's user role with a models.json slug"
  )
  .option(
    "--judges <models>",
    "override the profile's judges role with comma-separated models.json slugs (odd count)"
  )
  .option(
    "-i, --input <path>",
    "input scenarios JSONL file",
    defaultScenariosPath
  )
  .option("-o, --output <path>", "output results JSON file", defaultResultsPath)
  .option(
    "--prompts <prompts>",
    "comma-separated prompts to test (default, child)",
    ScenarioPrompt.list[0]
  )
  .option(
    "--risk-ids <ids>",
    "comma-separated risk IDs to restrict the run to (defaults to all scenarios in the input file)"
  )
  .option(
    "--limit <count>",
    "maximum number of test tasks to run (useful for smoke tests)"
  )
  .option(
    "--concurrency <n>",
    "max test tasks run in parallel (default 10; use 1 when the target is a single shared app account, e.g. kora-app-*)",
    "10"
  )
  .option(
    "--reverse",
    "process scenarios in reverse file order (last scenario first); useful for order-effect comparisons"
  )
  .option(
    "--cooldown <seconds>",
    "seconds to sleep between sequential test tasks; use with --concurrency 1 to avoid app rate-limiting (default 0)",
    "0"
  )
  .option(
    "--language <name>",
    'natural language of the conversation, e.g. "Estonian": the simulated child writes in it and the target model is told to answer in it (default: English)'
  )
  .action((targetModel, userModel, opts) => {
    const limit =
      opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new Error(
        `--limit must be a positive integer (got: ${opts.limit})`
      );
    }
    const concurrency = parseInt(opts.concurrency, 10);
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      throw new Error(
        `--concurrency must be a positive integer (got: ${opts.concurrency})`
      );
    }
    const cooldownSeconds = parseInt(opts.cooldown, 10);
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
      throw new Error(
        `--cooldown must be a non-negative integer (got: ${opts.cooldown})`
      );
    }

    return runCommand(
      program,
      modelsJsonPath,
      targetModel,
      {judges: optionalCsv(opts.judges), user: optionalCsv(userModel)},
      opts.input,
      opts.output,
      opts.prompts.split(",").map(p => v.parse(ScenarioPrompt.io, p.trim())),
      {
        riskIds: opts.riskIds
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        limit,
        concurrency,
        reverse: opts.reverse === true,
        cooldownMs: cooldownSeconds * 1000,
        language: opts.language,
      }
    );
  });

program
  .command("reassess")
  .description(
    "re-run the judge/assessment step on pre-recorded conversations (skips target + user models)"
  )
  .argument(
    "[user-model]",
    "override the profile's user role with a models.json slug; only recorded into each output JSON's `user` field (no user model is invoked)"
  )
  .option(
    "--judges <models>",
    "override the profile's judges role with comma-separated models.json slugs (odd count)"
  )
  .option(
    "-i, --input <path>",
    "input JSONL of recorded conversations ({id, modelId, scenario, prompt, messages})",
    defaultReassessInputPath
  )
  .option(
    "-o, --output <dir>",
    "output directory (one {modelId}.json per target)",
    defaultReassessOutputDir
  )
  .option(
    "--risk-ids <ids>",
    "comma-separated risk IDs to restrict the run to (defaults to all records in the input file)"
  )
  .option(
    "--target-models <ids>",
    "comma-separated target modelIds to restrict the run to (defaults to all modelIds in the input file)"
  )
  .option(
    "--limit <count>",
    "maximum number of records to reassess (useful for smoke tests)"
  )
  .action((userModel, opts) => {
    const limit =
      opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new Error(
        `--limit must be a positive integer (got: ${opts.limit})`
      );
    }

    return reassessCommand(
      program,
      modelsJsonPath,
      {judges: optionalCsv(opts.judges), user: optionalCsv(userModel)},
      opts.input,
      opts.output,
      {
        riskIds: opts.riskIds
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        targetModels: opts.targetModels
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        limit,
      }
    );
  });

program
  .command("continue")
  .description(
    "extend pre-recorded conversations with additional turns (up to each risk's conversationLength), then judge the full transcript"
  )
  .argument(
    "[user-model]",
    "override the profile's continueUser role with a models.json slug"
  )
  .option(
    "--judges <models>",
    "override the profile's judges role with comma-separated models.json slugs (odd count)"
  )
  .option(
    "-i, --input <path>",
    "input JSONL of recorded conversations ({id, modelId, scenario, prompt, messages})",
    defaultReassessInputPath
  )
  .option(
    "-o, --output <dir>",
    "output directory (one {modelId}.json per target)",
    defaultContinueOutputDir
  )
  .option(
    "--risk-ids <ids>",
    "comma-separated risk IDs to restrict the run to (defaults to all records in the input file)"
  )
  .option(
    "--target-models <ids>",
    "comma-separated target modelIds to restrict the run to (defaults to all modelIds in the input file)"
  )
  .option(
    "--limit-per-risk <count>",
    "maximum number of records per risk (deterministic by record id; fails fast if any requested risk has fewer records than requested)"
  )
  .option(
    "--language <name>",
    'natural language of the added turns, e.g. "Estonian" (default: English)'
  )
  .action((userModel, opts) => {
    const limitPerRisk =
      opts.limitPerRisk !== undefined
        ? parseInt(opts.limitPerRisk, 10)
        : undefined;
    if (
      limitPerRisk !== undefined &&
      (!Number.isFinite(limitPerRisk) || limitPerRisk <= 0)
    ) {
      throw new Error(
        `--limit-per-risk must be a positive integer (got: ${opts.limitPerRisk})`
      );
    }

    return continueCommand(
      program,
      modelsJsonPath,
      {judges: optionalCsv(opts.judges), continueUser: optionalCsv(userModel)},
      opts.input,
      opts.output,
      {
        riskIds: opts.riskIds
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        targetModels: opts.targetModels
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        limitPerRisk,
        language: opts.language,
      }
    );
  });

program
  .command("compare-assessments")
  .description(
    "compare two assessments-list JSONs (original vs new) and print agreement + flip matrices"
  )
  .option(
    "--original <path>",
    "original/baseline assessments JSON",
    defaultCompareOriginalPath
  )
  .option(
    "--new <path>",
    "new assessments JSON (reassess output)",
    defaultCompareNewPath
  )
  .option("--csv <path>", "write per-record detail CSV to this path")
  .action(opts =>
    compareAssessmentsCommand(program, opts.original, opts.new, {
      csvPath: opts.csv,
    })
  );

program
  .command("stats")
  .description(
    "report per-mechanism grade distributions across an assessments JSON; flags mechanisms with no discriminative signal"
  )
  .option(
    "-i, --input <path>",
    "input assessments JSON (array of {id, modelId, assessment, behaviorAssessment})",
    defaultCompareNewPath
  )
  .option(
    "--mechanism-ids <ids>",
    "comma-separated mechanism IDs to report (defaults to all mechanisms)"
  )
  .option("--by-model", "also print a per-model breakdown")
  .action(opts =>
    statsCommand(program, opts.input, {
      mechanismIds: opts.mechanismIds
        ?.split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0),
      byModel: opts.byModel === true,
    })
  );

program
  .command("validate")
  .description(
    "check that an input file's risk references resolve against the active taxonomy"
  )
  .option(
    "-i, --input <path>",
    "input JSONL file (seeds, scenarios, or reassess records)",
    defaultScenariosPath
  )
  .option(
    "--kind <kind>",
    "record kind: seeds, scenarios or reassess (default: inferred from the first record)"
  )
  .option(
    "--packs-only",
    "print the active profile, taxonomy and behavior pack, then stop without reading the input"
  )
  .action(opts => {
    const kind = opts.kind as InputKind | undefined;
    if (kind && !["seeds", "scenarios", "reassess"].includes(kind)) {
      throw new Error(
        `--kind must be one of: seeds, scenarios, reassess (got: ${opts.kind})`
      );
    }
    return validateCommand(program, modelsJsonPath, opts.input, {
      kind,
      packsOnly: opts.packsOnly === true,
    });
  });

program
  .command("profile")
  .description(
    "print the active evaluation profile (every role with its full model config, prompts fingerprint, packs, code revision)"
  )
  .option(
    "--check",
    "send a one-word prompt to every model in the profile and report the served model id, latency and pass/fail (needs AI_GATEWAY_API_KEY)"
  )
  .option(
    "--print-hash",
    "print only the profile's recomputed content hash (paste it into the file after bumping its version)"
  )
  .action(opts =>
    profileCommand(program, modelsJsonPath, program.opts().profile, {
      check: opts.check === true,
      printHash: opts.printHash === true,
    })
  );

program.parseAsync();
