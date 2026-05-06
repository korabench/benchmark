#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import {
  AgeRange,
  PopulationDistribution,
  ScenarioPrompt,
} from "@korabench/benchmark";
import {existsSync, readFileSync} from "node:fs";
import * as path from "node:path";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import * as v from "valibot";
import {compareAssessmentsCommand} from "./commands/compareAssessmentsCommand.js";
import {continueCommand} from "./commands/continueCommand.js";
import {expandScenariosCommand} from "./commands/expandScenariosCommand.js";
import {generateSeeds} from "./commands/generateSeedsCommand.js";
import {reassessCommand} from "./commands/reassessCommand.js";
import {runCommand} from "./commands/runCommand.js";
import {statsCommand} from "./commands/statsCommand.js";

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

function readPackageVersion(): string {
  const pkgPath = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../package.json"
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version || "0.0.0";
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
  .option("-d, --debug", "print full errors and debug information");

export type Program = typeof program;

program
  .command("generate-seeds")
  .description("generate a new set of scenario seeds")
  .argument("[model]", "model to use for seed generation", "gpt-4o")
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

    return generateSeeds(program, modelsJsonPath, model, opts.output, {
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
    });
  });

program
  .command("expand-scenarios")
  .description("transform the seeds into fully fleshed out scenarios")
  .argument("[model]", "model to use for seed expansion", "gpt-5.2:high")
  .argument(
    "[user-model]",
    "model to use for user message generation",
    "deepseek-v3.2"
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
  .action((model, userModel, opts) =>
    expandScenariosCommand(
      program,
      modelsJsonPath,
      model,
      userModel,
      opts.input,
      opts.output,
      opts.riskIds
        ?.split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0)
    )
  );

program
  .command("run")
  .description("run the benchmark with the provided scenarios")
  .argument("<target-model>", "model to benchmark")
  .argument(
    "[user-model]",
    "model to use for user message generation",
    "deepseek-v3.2"
  )
  .option(
    "--judges <models>",
    "comma-separated judge models",
    "gpt-5.2:high:limited,claude-sonnet-4.6:limited,gemini-2.5-pro:limited"
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
  .action((targetModel, userModel, opts) => {
    const limit =
      opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new Error(
        `--limit must be a positive integer (got: ${opts.limit})`
      );
    }

    return runCommand(
      program,
      modelsJsonPath,
      targetModel,
      opts.judges.split(",").map(s => s.trim()),
      userModel,
      opts.input,
      opts.output,
      opts.prompts.split(",").map(p => v.parse(ScenarioPrompt.io, p.trim())),
      {
        riskIds: opts.riskIds
          ?.split(",")
          .map(id => id.trim())
          .filter(id => id.length > 0),
        limit,
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
    "label recorded into each output JSON's `user` field (the user model that originally produced the transcripts; no model is invoked)",
    "deepseek-v3.2"
  )
  .option(
    "--judges <models>",
    "comma-separated judge models",
    "gpt-5.2:high:limited,claude-sonnet-4.6:limited,gemini-2.5-pro:limited"
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
      opts.judges.split(",").map(s => s.trim()),
      userModel,
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
    "model to use for user message generation during the continuation",
    "deepseek-v3.2-temp-1.3"
  )
  .option(
    "--judges <models>",
    "comma-separated judge models",
    "gpt-5.2:high:limited"
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
      opts.judges.split(",").map(s => s.trim()),
      userModel,
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

program.parseAsync();
