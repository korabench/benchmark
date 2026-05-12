import {
  ModelMessage,
  ModelRequest,
  ModelResponse,
  SchemaWithOutput,
  TypedModelRequest,
  TypedModelResponse,
} from "@korabench/core";
import {AgeRange} from "./model/ageRange.js";
import {PopulationDistribution} from "./model/populationDistribution.js";
import {ScenarioPrompt} from "./model/scenarioPrompt.js";

export interface GenerateSeedsContext {
  getResponse: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
}

export interface ExpandScenarioContext {
  getResponse: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
  getUserResponse: (request: ModelRequest) => Promise<ModelResponse>;
}

export interface JudgeModel {
  getResponse: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
}

export type TraceEvent =
  | {phase: "user_message"; turn: number; durationMs: number}
  | {phase: "assistant_response"; turn: number; durationMs: number}
  | {phase: "judge"; slug: string; durationMs: number}
  | {phase: "judges"; durationMs: number; judgeCount: number};

export interface TestContext {
  getUserResponse: (request: ModelRequest) => Promise<ModelResponse>;
  getAssistantResponse: (request: ModelRequest) => Promise<ModelResponse>;
  /** Record of judge model slug → callable judge model. */
  judgeModels: Record<string, JudgeModel>;
  /** Optional observability hook. No-op when undefined. */
  trace?: (event: TraceEvent) => void;
}

export interface GenerationEvent<T> {
  total: number;
  items: readonly T[];
}

export interface GenerateSeedsOptions {
  seedsPerTask?: number;
  totalSeeds?: number;
  ageRanges?: AgeRange[];
  riskIds?: readonly string[];
  motivations?: readonly string[];
  distribution?: PopulationDistribution;
  randomSeed?: number;
}

export interface Benchmark<TScenarioSeed, TScenario, TTestResult, TRunResult> {
  scenarioSeedType: SchemaWithOutput<TScenarioSeed>;
  scenarioType: SchemaWithOutput<TScenario>;
  testResultType: SchemaWithOutput<TTestResult>;
  runResultType: SchemaWithOutput<TRunResult>;
  generateScenarioSeeds(
    c: GenerateSeedsContext,
    options?: GenerateSeedsOptions
  ): AsyncGenerator<GenerationEvent<TScenarioSeed>>;
  expandScenario(
    c: ExpandScenarioContext,
    seed: TScenarioSeed
  ): Promise<readonly TScenario[]>;
  mapScenarioToKeys(
    scenario: TScenario,
    prompts?: readonly ScenarioPrompt[]
  ): readonly string[];
  runTest(
    c: TestContext,
    scenario: TScenario,
    key: string,
    startMessages?: readonly ModelMessage[]
  ): Promise<TTestResult>;
  mapTestResultToRunResult(result: TTestResult): TRunResult;
  reduceRunResult(result1: TRunResult, result2: TRunResult): TRunResult;
}

export const Benchmark = {
  new: <TSS, TS, TR, R>(benchmark: Benchmark<TSS, TS, TR, R>) => {
    return benchmark;
  },
};
