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
  /** Natural language the simulated child writes in (e.g. "Estonian"). The
   * scenario itself stays English; only the generated first user message is
   * translated. Undefined keeps the default English. */
  language?: string;
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
  /** Natural language the conversation is held in (e.g. "Estonian"): the
   * simulated child writes in it and the target model is told to answer in it.
   * Undefined keeps the default English. */
  language?: string;
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
  //
  // Schema accessors.
  //
  // Implementations whose schemas depend on the active pack MUST expose these
  // as getters (see `kora.ts`). Reading a pack-dependent schema at module scope
  // freezes it against whichever pack was active at import time, which no type
  // error catches — `packs/__tests__/moduleInit.test.ts` is the only guard.
  //
  readonly scenarioSeedType: SchemaWithOutput<TScenarioSeed>;
  readonly scenarioType: SchemaWithOutput<TScenario>;
  readonly testResultType: SchemaWithOutput<TTestResult>;
  readonly runResultType: SchemaWithOutput<TRunResult>;
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
