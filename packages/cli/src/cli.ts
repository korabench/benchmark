#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import {AgeRange, ScenarioPrompt} from "@korabench/benchmark";
import {existsSync, readFileSync} from "node:fs";
import * as path from "node:path";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import * as v from "valibot";
import {expandScenariosCommand} from "./commands/expandScenariosCommand.js";
import {generateSeeds} from "./commands/generateSeedsCommand.js";
import {runCommand} from "./commands/runCommand.js";

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
    "number of seeds to generate per risk/age/motivation combination",
    "8"
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
  .action((model, opts) =>
    generateSeeds(program, modelsJsonPath, model, opts.output, {
      seedsPerTask: parseInt(opts.seedsPerTask, 10),
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
    })
  );

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
    "gpt-5.2:high:limited"
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

program.parseAsync();
