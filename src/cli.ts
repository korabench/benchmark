#!/usr/bin/env node
import {Command} from "@commander-js/extra-typings";
import finder from "find-package-json";
import * as path from "node:path";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {expandScenariosCommand} from "./cli/expandScenariosCommand.js";
import {generateSeeds} from "./cli/generateSeedsCommand.js";
import {runCommand} from "./cli/runCommand.js";

function metaToPaths(meta: ImportMeta) {
  const filePath = fileURLToPath(meta.url);
  const directoryPath = dirname(filePath);
  return {directoryPath, filePath};
}

const {directoryPath} = metaToPaths(import.meta);
const dataPath = path.resolve(directoryPath, "..", "..", "data");
const version = finder(directoryPath).next().value?.version || "0.0.0";

const defaultSeedsPath = path.join(dataPath, "seeds.jsonl");
const defaultScenariosPath = path.join(dataPath, "scenarios.jsonl");
const defaultResultsPath = path.join(dataPath, "results.jsonl");

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
  .version(version, "-v, --version")
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
  .action((model, outputPath) => generateSeeds(program, model, outputPath));

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
    "path of the output results JSONL file",
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
