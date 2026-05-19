import {kora, Scenario, ScenarioPrompt, TestResult} from "@korabench/benchmark";
import {Hash, Script} from "@korabench/core";
import archiver from "archiver";
import {createWriteStream} from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import {flatTransform, pipeline, reduce} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
import {createGatewayModel} from "../models/gatewayModel.js";
import {Model} from "../models/model.js";
import {
  buildContext,
  resolveTargetGatewayModel,
} from "./shared/buildContext.js";

interface TestTask {
  scenario: Scenario;
  key: string;
}

type TaskOutcome =
  | {kind: "success"; testResult: TestResult}
  | {kind: "failure"};

type RunResult = v.InferOutput<typeof kora.runResultType>;

interface RunState {
  failureCount: number;
  testCount: number;
  runResult: RunResult | undefined;
}

export interface ScenarioFilters {
  riskIds?: ReadonlySet<string>;
  limit?: number;
  /** Process scenarios last-first (buffers the matched task list, then
   * reverses, then applies limit). Used for order-effect comparisons. */
  reverse?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function taskTempFileName(key: string): string {
  return Hash.shortHash(key) + ".json";
}

export async function* readScenariosFromJsonl(
  filePath: string,
  filters?: ScenarioFilters
): AsyncGenerator<Scenario> {
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const scenario = v.parse(Scenario.io, JSON.parse(trimmed));
    if (filters?.riskIds && !filters.riskIds.has(scenario.seed.riskId)) {
      continue;
    }
    yield scenario;
  }
}

export async function* scenariosToTestTasks(
  filePath: string,
  prompts: readonly ScenarioPrompt[],
  filters: ScenarioFilters
): AsyncGenerator<TestTask> {
  if (filters.reverse) {
    // Reverse requires the full matched list up front; the corpus is small
    // (one risk = tens of scenarios) so buffering is cheap. Limit is applied
    // AFTER reversing, i.e. it keeps the first N of the reversed order.
    const tasks: TestTask[] = [];
    for await (const scenario of readScenariosFromJsonl(filePath, filters)) {
      for (const key of kora.mapScenarioToKeys(scenario, prompts)) {
        tasks.push({scenario, key});
      }
    }
    tasks.reverse();
    const capped =
      filters.limit !== undefined ? tasks.slice(0, filters.limit) : tasks;
    for (const task of capped) {
      yield task;
    }
    return;
  }

  let yielded = 0;
  for await (const scenario of readScenariosFromJsonl(filePath, filters)) {
    for (const key of kora.mapScenarioToKeys(scenario, prompts)) {
      if (filters.limit !== undefined && yielded >= filters.limit) {
        return;
      }
      yield {scenario, key};
      yielded++;
    }
  }
}

export async function countTestTasks(
  filePath: string,
  prompts: readonly ScenarioPrompt[],
  filters: ScenarioFilters
): Promise<number> {
  let count = 0;
  for await (const scenario of readScenariosFromJsonl(filePath, filters)) {
    count += kora.mapScenarioToKeys(scenario, prompts).length;
    if (filters.limit !== undefined && count >= filters.limit) {
      return filters.limit;
    }
  }
  return count;
}

async function archiveResults(
  sourceDir: string,
  files: readonly string[],
  zipFilePath: string
): Promise<void> {
  const output = createWriteStream(zipFilePath);
  const archive = archiver("zip", {zlib: {level: 9}});
  const done = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.directory(sourceDir, "testResults");
  for (const file of files) {
    archive.file(file, {name: path.basename(file)});
  }
  await archive.finalize();
  await done;
}

async function hasTempFiles(tempDir: string): Promise<boolean> {
  try {
    const files = await fs.readdir(tempDir);
    return files.length > 0;
  } catch {
    return false;
  }
}

export interface RunCommandOptions {
  riskIds?: readonly string[];
  limit?: number;
  /** Max test tasks run in parallel. Defaults to 10. Set to 1 when the target
   * is a single shared app account (kora-app-*) to avoid concurrent-session
   * rate-limiting / bot-flagging. */
  concurrency?: number;
  /** Process scenarios last-first. See ScenarioFilters.reverse. */
  reverse?: boolean;
  /** Milliseconds to sleep between sequential freshly-executed test tasks
   * (skipped before the first task and for graceful-restart cache hits).
   * Pair with concurrency=1 to space out calls to a rate-limited app. */
  cooldownMs?: number;
}

export async function runCommand(
  _program: Program,
  modelsJsonPath: string,
  targetModelSlug: string,
  judgeModelSlugs: readonly string[],
  userModelSlug: string,
  scenariosFilePath: string,
  outputFilePath: string,
  prompts: readonly ScenarioPrompt[],
  options: RunCommandOptions = {}
) {
  console.log(
    `Running benchmark: target=${targetModelSlug}, judges=${judgeModelSlugs.join(",")}, user=${userModelSlug}`
  );

  if (judgeModelSlugs.length % 2 === 0)
    throw new Error(
      "The current implementation only supports odd numbers of judges. This ensures that the median assessment is always defined. See `aggregateTestAssessments` for reference."
    );

  const filters: ScenarioFilters = {
    riskIds: options.riskIds?.length ? new Set(options.riskIds) : undefined,
    limit: options.limit,
    reverse: options.reverse === true,
  };
  if (filters.riskIds) {
    console.log(`Filtering to risk IDs: ${[...filters.riskIds].join(", ")}`);
  }
  if (filters.limit !== undefined) {
    console.log(`Limiting to first ${filters.limit} test task(s).`);
  }
  if (filters.reverse) {
    console.log("Processing scenarios in REVERSE order (last scenario first).");
  }
  const concurrency = options.concurrency ?? 10;
  console.log(`Concurrency: ${concurrency} parallel test task(s).`);
  const cooldownMs = options.cooldownMs ?? 0;
  if (cooldownMs > 0) {
    console.log(`Cooldown between sequential tasks: ${cooldownMs / 1000}s.`);
  }
  let freshStarted = 0;

  const judgeModels: Record<string, Model> = Object.fromEntries(
    judgeModelSlugs.map(slug => [
      slug,
      createGatewayModel(modelsJsonPath, slug),
    ])
  );
  const userModel = createGatewayModel(modelsJsonPath, userModelSlug);
  const targetGatewayModel = resolveTargetGatewayModel(
    modelsJsonPath,
    targetModelSlug
  );

  const outputDir = path.dirname(outputFilePath);
  const tempDir = path.join(outputDir, ".kora-run-tmp");

  // Clear output file if no process in progress (no temp files)
  if (!(await hasTempFiles(tempDir))) {
    await fs.mkdir(outputDir, {recursive: true});
    await fs.writeFile(outputFilePath, "");
  }

  await fs.mkdir(tempDir, {recursive: true});

  const totalTests = await countTestTasks(scenariosFilePath, prompts, filters);

  if (totalTests === 0) {
    if (filters.riskIds || filters.limit !== undefined) {
      throw new Error(
        "No scenarios matched the provided filters. Check --risk-ids / --limit against the input file."
      );
    }
    throw new Error(`No scenarios found in ${scenariosFilePath}.`);
  }

  const progress = Script.progress(totalTests, text =>
    process.stdout.write(text)
  );

  const {failureCount, testCount, runResult} = await pipeline(
    () => scenariosToTestTasks(scenariosFilePath, prompts, filters),
    flatTransform(
      concurrency,
      async (task: TestTask): Promise<TaskOutcome[]> => {
        const tempFile = path.join(tempDir, taskTempFileName(task.key));

        // Check if already processed (graceful restart).
        try {
          const content = await fs.readFile(tempFile, "utf-8");
          progress.increment(true);
          const testResult = v.parse(kora.testResultType, JSON.parse(content));
          return [{kind: "success", testResult}];
        } catch {
          // Not yet processed.
        }

        // Cooldown: space out fresh executions to avoid app rate-limiting.
        // Skipped before the very first fresh task and (via the early return
        // above) for graceful-restart cache hits, so there is no trailing or
        // leading dead time. Race-free at concurrency=1, which is the only
        // setting where cooldown is meaningful.
        if (cooldownMs > 0 && freshStarted > 0) {
          console.log(
            `\nCooldown ${cooldownMs / 1000}s before next task (${task.key})…`
          );
          await sleep(cooldownMs);
        }
        freshStarted++;

        const built = await buildContext(
          judgeModels,
          userModel,
          targetModelSlug,
          targetGatewayModel,
          task.scenario
        );

        let outcome: "completed" | "errored" = "errored";
        try {
          const testResult = await kora.runTest(
            built.context,
            task.scenario,
            task.key
          );
          outcome = "completed";
          await fs.writeFile(tempFile, JSON.stringify(testResult, null, 2));
          progress.increment(true);
          return [{kind: "success", testResult}];
        } catch (error) {
          console.error(`\nTest failed for key ${task.key}: ${error}`);
          progress.increment(false);
          return [{kind: "failure"}];
        } finally {
          await built.dispose(outcome).catch(err => {
            console.error(
              `\nDispose failed for key ${task.key}: ${err instanceof Error ? err.message : err}`
            );
          });
        }
      }
    ),
    reduce(
      (state: RunState, outcome: TaskOutcome): RunState => {
        if (outcome.kind === "failure") {
          return {...state, failureCount: state.failureCount + 1};
        }

        const mapped = kora.mapTestResultToRunResult(outcome.testResult);
        return {
          failureCount: state.failureCount,
          testCount: state.testCount + 1,
          runResult: state.runResult
            ? kora.reduceRunResult(state.runResult, mapped)
            : mapped,
        };
      },
      {failureCount: 0, testCount: 0, runResult: undefined} as RunState
    )
  );

  progress.finish();

  if (failureCount > 0) {
    console.log(
      `\n${failureCount} tests failed. Temp files kept at ${tempDir} for restart.`
    );
    console.log(`Re-run the command to retry failed tests.`);
    return;
  }

  // Write reduced result.
  const result = {
    target: targetModelSlug,
    judges: judgeModelSlugs,
    user: userModelSlug,
    prompts,
    ...(runResult ?? {}),
  };

  await fs.mkdir(outputDir, {recursive: true});
  await fs.writeFile(outputFilePath, JSON.stringify(result, null, 2));

  // Archive results before cleaning up.
  const ext = path.extname(outputFilePath);
  const zipFilePath =
    (ext ? outputFilePath.slice(0, -ext.length) : outputFilePath) + ".zip";
  await archiveResults(tempDir, [outputFilePath], zipFilePath);

  await fs.rm(tempDir, {recursive: true, force: true});

  console.log(`\nCompleted ${testCount} tests → ${outputFilePath}`);
  console.log(`Test results archived → ${zipFilePath}`);
}
