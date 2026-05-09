import {
  JudgeModel,
  kora,
  runJudges,
  ScenarioKey,
  ScenarioPrompt,
  TestResult,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import archiver from "archiver";
import {createWriteStream} from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as R from "remeda";
import {flatTransform, pipeline, reduce} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
import {createModel} from "../models/createModel.js";
import {Model} from "../models/model.js";
import {
  readReassessInputsFromJsonl,
  ReassessInput,
} from "./shared/reassessInput.js";

interface ReassessTask {
  input: ReassessInput;
  key: string;
}

type TaskOutcome =
  | {
      kind: "success";
      id: string;
      modelId: string;
      prompt: ScenarioPrompt;
      testResult: TestResult;
    }
  | {kind: "failure"};

type RunResult = v.InferOutput<typeof kora.runResultType>;

interface RecordAssessment {
  id: string;
  modelId: string;
  assessment: TestResult["assessment"];
  behaviorAssessment: TestResult["mechanismAssessment"];
}

interface RunState {
  failureCount: number;
  testCount: number;
  runResultsByTarget: Map<string, RunResult>;
  promptsByTarget: Map<string, Set<ScenarioPrompt>>;
  recordAssessments: RecordAssessment[];
}

export interface ReassessFilters {
  riskIds?: ReadonlySet<string>;
  targetModels?: ReadonlySet<string>;
  limit?: number;
}

async function* reassessInputsToTasks(
  filePath: string,
  filters: ReassessFilters
): AsyncGenerator<ReassessTask> {
  let yielded = 0;
  for await (const input of readReassessInputsFromJsonl(filePath, filters)) {
    if (filters.limit !== undefined && yielded >= filters.limit) return;
    const key = ScenarioKey.toString(
      ScenarioKey.ofScenario(input.scenario, input.prompt)
    );
    yield {input, key};
    yielded++;
  }
}

async function countReassessTasks(
  filePath: string,
  filters: ReassessFilters
): Promise<number> {
  let count = 0;
  for await (const _ of readReassessInputsFromJsonl(filePath, filters)) {
    count++;
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

function buildJudgeContext(
  judgeModels: Record<string, Model>
): Record<string, JudgeModel> {
  return R.mapValues(
    judgeModels,
    (model: Model): JudgeModel => ({
      getResponse: async request => ({
        output: await model.getStructuredResponse(request),
      }),
    })
  );
}

export interface ReassessCommandOptions {
  riskIds?: readonly string[];
  targetModels?: readonly string[];
  limit?: number;
}

export async function reassessCommand(
  _program: Program,
  modelsJsonPath: string,
  judgeModelSlugs: readonly string[],
  userModelSlug: string,
  inputFilePath: string,
  outputDirPath: string,
  options: ReassessCommandOptions = {}
) {
  console.log(
    `Reassessing transcripts: judges=${judgeModelSlugs.join(",")}, user-label=${userModelSlug}`
  );

  if (judgeModelSlugs.length % 2 === 0)
    throw new Error(
      "The current implementation only supports odd numbers of judges. This ensures that the median assessment is always defined. See `aggregateTestAssessments` for reference."
    );

  const filters: ReassessFilters = {
    riskIds: options.riskIds?.length ? new Set(options.riskIds) : undefined,
    targetModels: options.targetModels?.length
      ? new Set(options.targetModels)
      : undefined,
    limit: options.limit,
  };
  if (filters.riskIds) {
    console.log(`Filtering to risk IDs: ${[...filters.riskIds].join(", ")}`);
  }
  if (filters.targetModels) {
    console.log(
      `Filtering to target models: ${[...filters.targetModels].join(", ")}`
    );
  }
  if (filters.limit !== undefined) {
    console.log(`Limiting to first ${filters.limit} record(s).`);
  }

  const judgeModels: Record<string, Model> = Object.fromEntries(
    judgeModelSlugs.map(slug => [slug, createModel(modelsJsonPath, slug)])
  );
  const judgeContext = buildJudgeContext(judgeModels);

  const tempDir = path.join(outputDirPath, ".kora-reassess-tmp");

  await fs.mkdir(outputDirPath, {recursive: true});
  await fs.mkdir(tempDir, {recursive: true});

  const totalTests = await countReassessTasks(inputFilePath, filters);

  if (totalTests === 0) {
    if (
      filters.riskIds ||
      filters.targetModels ||
      filters.limit !== undefined
    ) {
      throw new Error(
        "No records matched the provided filters. Check --risk-ids / --target-models / --limit against the input file."
      );
    }
    throw new Error(`No records found in ${inputFilePath}.`);
  }

  const progress = Script.progress(totalTests, text =>
    process.stdout.write(text)
  );

  const {
    failureCount,
    testCount,
    runResultsByTarget,
    promptsByTarget,
    recordAssessments,
  } = await pipeline(
    () => reassessInputsToTasks(inputFilePath, filters),
    flatTransform(10, async (task: ReassessTask): Promise<TaskOutcome[]> => {
      const tempFile = path.join(tempDir, `${task.input.id}.json`);

      // Graceful restart.
      try {
        const content = await fs.readFile(tempFile, "utf-8");
        const testResult = v.parse(kora.testResultType, JSON.parse(content));
        progress.increment(true);
        return [
          {
            kind: "success",
            id: task.input.id,
            modelId: task.input.modelId,
            prompt: task.input.prompt,
            testResult,
          },
        ];
      } catch {
        // Not yet processed.
      }

      try {
        const testResult = await runJudges(
          judgeContext,
          task.input.scenario,
          task.input.prompt,
          task.input.messages
        );
        await fs.writeFile(tempFile, JSON.stringify(testResult, null, 2));
        progress.increment(true);
        return [
          {
            kind: "success",
            id: task.input.id,
            modelId: task.input.modelId,
            prompt: task.input.prompt,
            testResult,
          },
        ];
      } catch (error) {
        console.error(
          `\nJudge run failed for id=${task.input.id} (model=${task.input.modelId}, key=${task.key}): ${error}`
        );
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
        const prev = state.runResultsByTarget.get(outcome.modelId);
        const next = prev ? kora.reduceRunResult(prev, mapped) : mapped;
        state.runResultsByTarget.set(outcome.modelId, next);

        const prompts = state.promptsByTarget.get(outcome.modelId) ?? new Set();
        prompts.add(outcome.prompt);
        state.promptsByTarget.set(outcome.modelId, prompts);

        state.recordAssessments.push({
          id: outcome.id,
          modelId: outcome.modelId,
          assessment: outcome.testResult.assessment,
          behaviorAssessment: outcome.testResult.mechanismAssessment,
        });

        return {
          failureCount: state.failureCount,
          testCount: state.testCount + 1,
          runResultsByTarget: state.runResultsByTarget,
          promptsByTarget: state.promptsByTarget,
          recordAssessments: state.recordAssessments,
        };
      },
      {
        failureCount: 0,
        testCount: 0,
        runResultsByTarget: new Map<string, RunResult>(),
        promptsByTarget: new Map<string, Set<ScenarioPrompt>>(),
        recordAssessments: [] as RecordAssessment[],
      } as RunState
    )
  );

  progress.finish();

  if (failureCount > 0) {
    console.log(
      `\n${failureCount} reassessments failed. Temp files kept at ${tempDir} for restart.`
    );
    console.log(`Re-run the command to retry failed records.`);
    return;
  }

  const writtenFiles: string[] = [];
  for (const [modelId, runResult] of runResultsByTarget) {
    const prompts = [...(promptsByTarget.get(modelId) ?? new Set())];
    const result = {
      target: modelId,
      judges: judgeModelSlugs,
      user: userModelSlug,
      prompts,
      ...runResult,
    };
    const filePath = path.join(outputDirPath, `${modelId}.json`);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2));
    writtenFiles.push(filePath);
  }

  const assessmentsPath = path.join(outputDirPath, "assessments.json");
  const sortedAssessments = [...recordAssessments].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  await fs.writeFile(
    assessmentsPath,
    JSON.stringify(sortedAssessments, null, 2)
  );
  writtenFiles.push(assessmentsPath);

  const zipFilePath = path.join(outputDirPath, "results.zip");
  await archiveResults(tempDir, writtenFiles, zipFilePath);

  await fs.rm(tempDir, {recursive: true, force: true});

  console.log(
    `\nCompleted ${testCount} reassessments across ${runResultsByTarget.size} target model(s) → ${outputDirPath}`
  );
  console.log(
    `Per-record assessments → ${assessmentsPath} (${sortedAssessments.length} entries)`
  );
  console.log(`Results archived → ${zipFilePath}`);
}
