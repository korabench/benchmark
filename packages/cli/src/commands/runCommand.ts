import {
  kora,
  Scenario,
  ScenarioPrompt,
  TestContext,
  TestResult,
} from "@korabench/benchmark";
import {Hash, Script} from "@korabench/core";
import archiver from "archiver";
import {createWriteStream} from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import {flatTransform, pipeline, reduce} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
import {createCustomModel} from "../customModel.js";
import {createGatewayModel} from "../gatewayModel.js";
import {Model} from "../model.js";

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

function taskTempFileName(key: string): string {
  return Hash.shortHash(key) + ".json";
}

async function* readScenariosFromJsonl(
  filePath: string
): AsyncGenerator<Scenario> {
  const fh = await fs.open(filePath);
  const rl = readline.createInterface({input: fh.createReadStream()});
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    yield v.parse(Scenario.io, JSON.parse(trimmed));
  }
}

async function* scenariosToTestTasks(
  filePath: string,
  prompts: readonly ScenarioPrompt[]
): AsyncGenerator<TestTask> {
  for await (const scenario of readScenariosFromJsonl(filePath)) {
    for (const key of kora.mapScenarioToKeys(scenario, prompts)) {
      yield {scenario, key};
    }
  }
}

async function countTestTasks(
  filePath: string,
  prompts: readonly ScenarioPrompt[]
): Promise<number> {
  let count = 0;
  for await (const scenario of readScenariosFromJsonl(filePath)) {
    count += kora.mapScenarioToKeys(scenario, prompts).length;
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

async function buildContext(
  judgeModel: Model,
  userModel: Model,
  targetModelSlug: string,
  targetGatewayModel: Model | undefined,
  scenario: Scenario
): Promise<TestContext> {
  const targetModel = await (async () => {
    if (targetGatewayModel) {
      return targetGatewayModel;
    }

    return createCustomModel(targetModelSlug, scenario);
  })();

  return {
    getUserResponse: async request => ({
      output: await userModel.getTextResponse(request),
    }),
    getAssistantResponse: async request => ({
      output: await targetModel.getTextResponse(request),
    }),
    getJudgeResponse: async request => ({
      output: await judgeModel.getStructuredResponse(request),
    }),
  };
}

export async function runCommand(
  _program: Program,
  modelsJsonPath: string,
  judgeModelSlug: string,
  userModelSlug: string,
  targetModelSlug: string,
  scenariosFilePath: string,
  outputFilePath: string,
  prompts: readonly ScenarioPrompt[]
) {
  console.log(
    `Running benchmark: target=${targetModelSlug}, judge=${judgeModelSlug}, user=${userModelSlug}`
  );

  const judgeModel = createGatewayModel(modelsJsonPath, judgeModelSlug);
  const userModel = createGatewayModel(modelsJsonPath, userModelSlug);
  const targetGatewayModel = targetModelSlug.startsWith("custom-")
    ? undefined
    : createGatewayModel(modelsJsonPath, targetModelSlug);

  const outputDir = path.dirname(outputFilePath);
  const tempDir = path.join(outputDir, ".kora-run-tmp");

  // Clear output file if no process in progress (no temp files)
  if (!(await hasTempFiles(tempDir))) {
    await fs.mkdir(outputDir, {recursive: true});
    await fs.writeFile(outputFilePath, "");
  }

  await fs.mkdir(tempDir, {recursive: true});

  const totalTests = await countTestTasks(scenariosFilePath, prompts);
  const progress = Script.progress(totalTests, text =>
    process.stdout.write(text)
  );

  const {failureCount, testCount, runResult} = await pipeline(
    () => scenariosToTestTasks(scenariosFilePath, prompts),
    flatTransform(10, async (task: TestTask): Promise<TaskOutcome[]> => {
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

      const context = await buildContext(
        judgeModel,
        userModel,
        targetModelSlug,
        targetGatewayModel,
        task.scenario
      );

      try {
        const testResult = await kora.runTest(context, task.scenario, task.key);
        await fs.writeFile(tempFile, JSON.stringify(testResult, null, 2));
        progress.increment(true);
        return [{kind: "success", testResult}];
      } catch (error) {
        console.error(`\nTest failed for key ${task.key}: ${error}`);
        progress.increment(false);
        return [{kind: "failure"}];
      }
    }),
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
    judge: judgeModelSlug,
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
