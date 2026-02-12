#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import {ScenarioPrompt} from "@korabench/benchmark";
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

const defaultSeedsPath = path.join(dataPath, "scenarioSeeds.jsonl");
const defaultScenariosPath = path.join(dataPath, "scenarios.jsonl");
const defaultResultsPath = path.join(dataPath, "results.json");

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
  .argument("[model]", "model to use for seed generation", "gpt-5.2:high")
  .argument(
    "[output-path]",
    "path of the output seeds JSONL file",
    defaultSeedsPath
  )
  .option(
    "--seeds-per-task <count>",
    "number of seeds to generate per risk/age/motivation combination",
    "8"
  )
  .action((model, outputPath, opts) =>
    generateSeeds(program, modelsJsonPath, model, outputPath, {
      seedsPerTask: parseInt(opts.seedsPerTask, 10),
    })
  );

program
  .command("expand-scenarios")
  .description("transform the seeds into fully fleshed out scenarios")
  .argument("[model]", "model to use for seed expansion", "gpt-4o")
  .argument(
    "[user-model]",
    "model to use for user message generation",
    "deepseek-v3"
  )
  .argument(
    "[seeds-path]",
    "path of the input seeds JSONL file",
    defaultSeedsPath
  )
  .argument(
    "[output-path]",
    "path of the output scenarios JSONL file",
    defaultScenariosPath
  )
  .action((model, userModel, seedsPath, outputPath) =>
    expandScenariosCommand(
      program,
      modelsJsonPath,
      model,
      userModel,
      seedsPath,
      outputPath
    )
  );

program
  .command("run")
  .description("run the benchmark with the provided scenarios")
  .argument("[judge-model]", "model to use as judge", "gpt-5.2:high:limited")
  .argument(
    "[user-model]",
    "model to use for user message generation",
    "deepseek-v3"
  )
  .argument("<target-model>", "model to benchmark")
  .argument(
    "[scenarios-path]",
    "path of the input scenarios JSONL file",
    defaultScenariosPath
  )
  .argument(
    "[output-path]",
    "path of the output results JSON file",
    defaultResultsPath
  )
  .option(
    "--prompts <prompts>",
    "comma-separated prompts to test (default, child)",
    "default"
  )
  .action(
    (judgeModel, userModel, targetModel, scenariosPath, outputPath, opts) =>
      runCommand(
        program,
        modelsJsonPath,
        judgeModel,
        userModel,
        targetModel,
        scenariosPath,
        outputPath,
        opts.prompts.split(",").map(p => v.parse(ScenarioPrompt.io, p.trim()))
      )
  );

program.parseAsync();
