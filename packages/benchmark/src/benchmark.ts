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
import {Scenario} from "./model/scenario.js";
import {ScenarioPrompt} from "./model/scenarioPrompt.js";
import {ScenarioSeed} from "./model/scenarioSeed.js";
import {ScenarioValidation} from "./model/scenarioValidation.js";
import {SeedValidation, SeedValidationVerdict} from "./model/seedValidation.js";

/** One verdict of the seed plausibility check. */
export interface SeedValidationEvent {
  /** Key of the slot the seed was written for. */
  key: string;
  /** 1-based, within this call of `generateScenarioSeeds`. */
  attempt: number;
  maxAttempts: number;
  /** The seed that was checked; the one kept when `verdict` is "pass". */
  seed: ScenarioSeed;
  isPrivate: boolean;
  validation: SeedValidation;
  verdict: SeedValidationVerdict;
}

/** One verdict of the scenario validation step. */
export interface ScenarioValidationEvent {
  seed: ScenarioSeed;
  /** 1-based, within this call of `expandScenario`. */
  attempt: number;
  maxAttempts: number;
  /** The scenario that was checked, with its first user message. */
  scenario: Scenario;
  validation: ScenarioValidation;
  /** Derived: the checklist passed and every question was answered yes. */
  verdict: "pass" | "fail";
  /** The checklist reasons and the reason of every question answered no. */
  reasons: string;
}

export interface GenerateSeedsContext {
  getResponse: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
  /**
   * The model checking each seed's plausibility. When set, a rejected seed is
   * regenerated for the same slot, with the rejection reasons, until it passes
   * or the attempts run out. Undefined skips the check.
   */
  getValidationResponse?: <T>(
    request: TypedModelRequest<T>
  ) => Promise<TypedModelResponse<T>>;
  /** Called after every verdict of the plausibility check, pass or fail. */
  onValidation?: (event: SeedValidationEvent) => void | Promise<void>;
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
  /** Called after every verdict of the validation step, pass or fail. */
  onValidation?: (event: ScenarioValidationEvent) => void | Promise<void>;
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
  /**
   * True when `items` are held out as private: they must be stored apart from
   * the public items and never published.
   */
  private?: boolean;
  /** Key of the seed slot `items` fills, for seed generation. */
  key?: string;
}

export interface GenerateSeedsOptions {
  /** Seeds to generate per risk. Defaults to `DEFAULT_TOTAL_SEEDS`. */
  totalSeeds?: number;
  /** Restricts and renormalizes the age dimension of `distribution`. */
  ageRanges?: AgeRange[];
  riskIds?: readonly string[];
  /** Restricts the motivations seeds are spread over. */
  motivations?: readonly string[];
  /** Target population. Defaults to `PopulationDistribution.default()`. */
  distribution?: PopulationDistribution;
  /** Makes every allocation reproducible. */
  randomSeed?: number;
  /**
   * Share of each risk's seeds held out as private, between 0 and 1. Defaults
   * to `DEFAULT_PRIVATE_RATIO`; 0 keeps every seed public.
   */
  privateRatio?: number;
  /**
   * Slots to leave out: already filled by an earlier run of the same plan.
   * See `planSeedSlots` for the keys.
   */
  skipSlotKeys?: ReadonlySet<string>;
  /**
   * Seeds written per slot before giving up on it, when the plausibility
   * check is on. Defaults to `DEFAULT_SEED_VALIDATION_ATTEMPTS`. A slot that
   * runs out yields no seed.
   */
  maxValidationAttempts?: number;
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
