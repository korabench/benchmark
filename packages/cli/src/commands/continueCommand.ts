import {
  kora,
  ScenarioKey,
  ScenarioPrompt,
  TestResult,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import archiver from "archiver";
import {createHash} from "node:crypto";
import {createWriteStream} from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {flatTransform, pipeline, reduce} from "streaming-iterables";
import * as v from "valibot";
import {Program} from "../cli.js";
import {createGatewayModel} from "../models/gatewayModel.js";
import {Model} from "../models/model.js";
import {
  buildContext,
  BuiltContext,
  resolveTargetGatewayModel,
} from "./shared/buildContext.js";
import {
  readReassessInputsFromJsonl,
  ReassessInput,
} from "./shared/reassessInput.js";

interface ContinueTask {
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

interface SelectionMeta {
  sourceInputPath: string;
  sourceInputSha256: string;
  userModelSlug: string;
  judgeModelSlugs: readonly string[];
  limitPerRisk: number | undefined;
  selectedIdsByRisk: Record<string, readonly string[]>;
  startedAt: string;
  completedAt?: string;
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
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

export interface ContinueCommandOptions {
  riskIds?: readonly string[];
  targetModels?: readonly string[];
  limitPerRisk?: number;
  /** Target system prompt used verbatim for records whose prompt is "custom".
   * Required when the input contains such records. */
  customSystemPrompt?: string;
}

export async function continueCommand(
  _program: Program,
  modelsJsonPath: string,
  judgeModelSlugs: readonly string[],
  userModelSlug: string,
  inputFilePath: string,
  outputDirPath: string,
  options: ContinueCommandOptions = {}
) {
  console.log(
    `Continuing transcripts: judges=${judgeModelSlugs.join(",")}, user=${userModelSlug}`
  );

  if (judgeModelSlugs.length % 2 === 0)
    throw new Error(
      "The current implementation only supports odd numbers of judges. This ensures that the median assessment is always defined. See `aggregateTestAssessments` for reference."
    );

  const riskIdsFilter = options.riskIds?.length
    ? new Set(options.riskIds)
    : undefined;
  const targetModelsFilter = options.targetModels?.length
    ? new Set(options.targetModels)
    : undefined;
  const limitPerRisk = options.limitPerRisk;

  if (riskIdsFilter) {
    console.log(`Filtering to risk IDs: ${[...riskIdsFilter].join(", ")}`);
  }
  if (targetModelsFilter) {
    console.log(
      `Filtering to target models: ${[...targetModelsFilter].join(", ")}`
    );
  }
  if (limitPerRisk !== undefined) {
    console.log(`Limiting to ${limitPerRisk} record(s) per risk.`);
  }

  // Read and sample eagerly so we can group by risk before processing.
  const allRecords: ReassessInput[] = [];
  for await (const record of readReassessInputsFromJsonl(inputFilePath, {
    riskIds: riskIdsFilter,
    targetModels: targetModelsFilter,
  })) {
    allRecords.push(record);
  }

  if (allRecords.length === 0) {
    if (riskIdsFilter || targetModelsFilter) {
      throw new Error(
        "No records matched the provided filters. Check --risk-ids / --target-models against the input file."
      );
    }
    throw new Error(`No records found in ${inputFilePath}.`);
  }

  const byRisk = new Map<string, ReassessInput[]>();
  for (const record of allRecords) {
    const riskId = record.scenario.seed.riskId;
    const bucket = byRisk.get(riskId) ?? [];
    bucket.push(record);
    byRisk.set(riskId, bucket);
  }

  const selectedIdsByRisk: Record<string, string[]> = {};
  const selectedRecords: ReassessInput[] = [];
  for (const [riskId, bucket] of [...byRisk.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const sorted = [...bucket].sort((a, b) => a.id.localeCompare(b.id));
    const picked =
      limitPerRisk !== undefined ? sorted.slice(0, limitPerRisk) : sorted;

    if (limitPerRisk !== undefined && picked.length < limitPerRisk) {
      throw new Error(
        `Risk "${riskId}" has only ${picked.length} record(s) in the input, but --limit-per-risk=${limitPerRisk} was requested.`
      );
    }

    selectedIdsByRisk[riskId] = picked.map(r => r.id);
    console.log(
      `[${riskId}] selected ${picked.length} of ${bucket.length} record(s)`
    );
    selectedRecords.push(...picked);
  }

  const judgeModels: Record<string, Model> = Object.fromEntries(
    judgeModelSlugs.map(slug => [
      slug,
      createGatewayModel(modelsJsonPath, slug),
    ])
  );
  const userModel = createGatewayModel(modelsJsonPath, userModelSlug);

  // Per-record target model resolution: cache by modelId across records.
  const targetGatewayCache = new Map<string, Model | undefined>();
  const getTargetGateway = (modelId: string): Model | undefined => {
    if (!targetGatewayCache.has(modelId)) {
      targetGatewayCache.set(
        modelId,
        resolveTargetGatewayModel(modelsJsonPath, modelId)
      );
    }
    return targetGatewayCache.get(modelId);
  };

  const tempDir = path.join(outputDirPath, ".kora-continue-tmp");
  await fs.mkdir(outputDirPath, {recursive: true});
  await fs.mkdir(tempDir, {recursive: true});

  const meta: SelectionMeta = {
    sourceInputPath: inputFilePath,
    sourceInputSha256: await sha256File(inputFilePath),
    userModelSlug,
    judgeModelSlugs,
    limitPerRisk,
    selectedIdsByRisk,
    startedAt: new Date().toISOString(),
  };
  const metaPath = path.join(outputDirPath, "continue-meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  const progress = Script.progress(selectedRecords.length, text =>
    process.stdout.write(text)
  );

  const tasks: ContinueTask[] = selectedRecords.map(input => ({
    input,
    key: ScenarioKey.toString(
      ScenarioKey.ofScenario(input.scenario, input.prompt)
    ),
  }));

  const {
    failureCount,
    testCount,
    runResultsByTarget,
    promptsByTarget,
    recordAssessments,
  } = await pipeline(
    () =>
      (async function* () {
        for (const task of tasks) yield task;
      })(),
    flatTransform(10, async (task: ContinueTask): Promise<TaskOutcome[]> => {
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

      let built: BuiltContext | undefined;
      let outcome: "completed" | "errored" = "errored";
      try {
        built = await buildContext(
          judgeModels,
          userModel,
          task.input.modelId,
          getTargetGateway(task.input.modelId),
          task.input.scenario,
          options.customSystemPrompt
        );
        const testResult = await kora.runTest(
          built.context,
          task.input.scenario,
          task.key,
          task.input.messages
        );
        outcome = "completed";
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
          `\nContinue run failed for id=${task.input.id} (model=${task.input.modelId}, key=${task.key}): ${error}`
        );
        progress.increment(false);
        return [{kind: "failure"}];
      } finally {
        if (built) {
          await built.dispose(outcome).catch(err => {
            console.error(
              `\nDispose failed for id=${task.input.id}: ${err instanceof Error ? err.message : err}`
            );
          });
        }
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
      `\n${failureCount} continuations failed. Temp files kept at ${tempDir} for restart.`
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

  const finalMeta: SelectionMeta = {
    ...meta,
    completedAt: new Date().toISOString(),
  };
  await fs.writeFile(metaPath, JSON.stringify(finalMeta, null, 2));
  writtenFiles.push(metaPath);

  const zipFilePath = path.join(outputDirPath, "results.zip");
  await archiveResults(tempDir, writtenFiles, zipFilePath);

  await fs.rm(tempDir, {recursive: true, force: true});

  console.log(
    `\nCompleted ${testCount} continuations across ${runResultsByTarget.size} target model(s) → ${outputDirPath}`
  );
  console.log(
    `Per-record assessments → ${assessmentsPath} (${sortedAssessments.length} entries)`
  );
  console.log(`Results archived → ${zipFilePath}`);
}
