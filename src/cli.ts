#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import finder from "find-package-json";
import * as path from "node:path";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {expandScenariosCommand} from "./cli/expandScenariosCommand.js";
import {generateSeeds} from "./cli/generateSeedsCommand.js";
import {runCommand} from "./cli/runCommand.js";

function findPackageRoot() {
  const filePath = fileURLToPath(import.meta.url);
  const result = finder(dirname(filePath)).next().value;
  if (!result || !result.__path) {
    throw new Error("Could not find package.json");
  }

  return {
    root: dirname(result.__path),
    version: result.version || "0.0.0",
  };
}

const pkg = findPackageRoot();
const dataPath = path.join(pkg.root, "data");

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
  .version(pkg.version, "-v, --version")
  .option("-d, --debug", "print full errors and debug information");

export type Program = typeof program;

program
  .command("generate-seeds")
  .description("generate a new set of scenario seeds")
  .argument("<model>", "model to use for seed generation")
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
    generateSeeds(program, model, outputPath, {
      seedsPerTask: parseInt(opts.seedsPerTask, 10),
    })
  );

program
  .command("expand-scenarios")
  .description("transform the seeds into fully fleshed out scenarios")
  .argument("<model>", "model to use for seed expansion")
  .argument("<user-model>", "model to use for user message generation")
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
    expandScenariosCommand(program, model, userModel, seedsPath, outputPath)
  );

program
  .command("run")
  .description("run the benchmark with the provided scenarios")
  .argument("<judge-model>", "model to use as judge")
  .argument("<user-model>", "model to use for user message generation")
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
  .action((judgeModel, userModel, targetModel, scenariosPath, outputPath) =>
    runCommand(
      program,
      judgeModel,
      userModel,
      targetModel,
      scenariosPath,
      outputPath
    )
  );

program.parseAsync();
