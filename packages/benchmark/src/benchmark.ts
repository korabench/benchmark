import {
  ModelRequest,
  ModelResponse,
  SchemaWithOutput,
  TypedModelRequest,
  TypedModelResponse,
} from "@korabench/core";
import {AgeRange} from "./model/ageRange.js";
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

export interface TestContext {
  getUserResponse: (request: ModelRequest) => Promise<ModelResponse>;
  getAssistantResponse: (request: ModelRequest) => Promise<ModelResponse>;
  getJudgeResponse: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
}

export interface GenerationEvent<T> {
  total: number;
  items: readonly T[];
}

export interface GenerateSeedsOptions {
  seedsPerTask?: number;
  ageRanges?: AgeRange[];
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
    key: string
  ): Promise<TTestResult>;
  mapTestResultToRunResult(result: TTestResult): TRunResult;
  reduceRunResult(result1: TRunResult, result2: TRunResult): TRunResult;
}

export const Benchmark = {
  new: <TSS, TS, TR, R>(benchmark: Benchmark<TSS, TS, TR, R>) => {
    return benchmark;
  },
};
