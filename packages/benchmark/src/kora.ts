import {ModelMessage} from "@korabench/core";
import * as R from "remeda";
import {flatTransform} from "streaming-iterables";
import {v4 as uuid} from "uuid";
import * as v from "valibot";
import {
  aggregateMechanismAssessments,
  aggregateTestAssessments,
} from "./aggregateAssessments.js";
import {allocateFlavors} from "./allocation/allocateFlavors.js";
import {
  allocatePersonas,
  PinnedDemographics,
} from "./allocation/allocatePersonas.js";
import {makeRng, shuffleWith} from "./allocation/rng.js";
import {Benchmark, JudgeModel} from "./benchmark.js";
import {
  generateFirstUserMessage,
  generateNextUserMessage,
} from "./generateUserMessage.js";
import {AgeRange} from "./model/ageRange.js";
import {AssessmentGrade} from "./model/assessmentGrade.js";
import {JudgeAssessment} from "./model/judgeAssessment.js";
import {Mechanism} from "./model/mechanism.js";
import {MechanismAssessment} from "./model/mechanismAssessment.js";
import {Motivation} from "./model/motivation.js";
import {Risk} from "./model/risk.js";
import {RiskCategory} from "./model/riskCategory.js";
import {
  RunAssessmentSums,
  RunMechanismSums,
  RunResult,
  RunResultScore,
} from "./model/runResult.js";
import {
  ModelScenario,
  ModelScenarioLight,
  ModelScenarioWithMemory,
  Scenario,
} from "./model/scenario.js";
import {ScenarioFlavor} from "./model/scenarioFlavor.js";
import {ScenarioKey} from "./model/scenarioKey.js";
import {ScenarioPrompt} from "./model/scenarioPrompt.js";
import {ModelScenarioSeed, ScenarioSeed} from "./model/scenarioSeed.js";
import {ScenarioValidation} from "./model/scenarioValidation.js";
import {ScenarioValidationError} from "./model/scenarioValidationError.js";
import {TestAssessment} from "./model/testAssessment.js";
import {TestResult} from "./model/testResult.js";
import {conversationToAssessmentPrompt} from "./prompts/conversationToAssessmentPrompt.js";
import {conversationToMechanismAssessmentPrompt} from "./prompts/conversationToMechanismAssessmentPrompt.js";
import {conversationToNextMessagePrompt} from "./prompts/conversationToNextMessagePrompt.js";
import {riskToScenarioSeedsPrompt} from "./prompts/riskToScenarioSeedsPrompt.js";
import {scenarioToValidationPrompt} from "./prompts/scenarioToValidationPrompt.js";
import {seedToScenarioPrompt} from "./prompts/seedToScenarioPrompt.js";

const AGE_BANDS: Record<AgeRange, readonly [number, number]> = {
  "7to9": [7, 9],
  "10to12": [10, 12],
  "13to17": [13, 17],
};

function clampAgeToBand(age: number, band: AgeRange): number {
  const [lo, hi] = AGE_BANDS[band];
  const rounded = Math.round(age);
  if (rounded < lo) return lo;
  if (rounded > hi) return hi;
  return rounded;
}

/**
 * Run the judge-assessment step on a pre-existing transcript.
 *
 * Mirrors the tail of `runTest` (prompt building → parallel judge calls →
 * aggregation) without regenerating the conversation. Used by the `reassess`
 * command to re-score exported prod transcripts.
 */
export async function runJudges(
  judgeModels: Record<string, JudgeModel>,
  scenario: Scenario,
  prompt: ScenarioPrompt,
  messages: readonly ModelMessage[]
): Promise<TestResult> {
  const riskCategory = RiskCategory.find(scenario.seed.riskCategoryId);
  const risk = RiskCategory.findRisk(riskCategory, scenario.seed.riskId);

  const assessmentPrompt = conversationToAssessmentPrompt(
    risk,
    scenario,
    messages
  );
  const mechanismPrompt = conversationToMechanismAssessmentPrompt(
    scenario,
    messages
  );

  const judgeSlugs = Object.keys(judgeModels);
  const judgeAssessments = await Promise.all(
    judgeSlugs.map(async (slug): Promise<JudgeAssessment> => {
      const judge = judgeModels[slug]!;

      const [safetyResult, mechanismResult] = await Promise.all([
        judge.getResponse({
          messages: [
            {role: "system", content: assessmentPrompt.system},
            {role: "user", content: assessmentPrompt.user},
          ],
          outputType: TestAssessment.io,
        }),
        judge.getResponse({
          messages: [
            {role: "system", content: mechanismPrompt.system},
            {role: "user", content: mechanismPrompt.user},
          ],
          outputType: MechanismAssessment.io,
        }),
      ]);

      return {
        judgeModelSlug: slug,
        assessment: safetyResult.output,
        mechanismAssessment: mechanismResult.output,
      };
    })
  );

  const assessment = aggregateTestAssessments(
    judgeAssessments.map(j => j.assessment)
  );
  const mechanismAssessment = aggregateMechanismAssessments(
    judgeAssessments.map(j => j.mechanismAssessment)
  );

  return {
    scenario,
    prompt,
    messages: [...messages],
    assessment,
    mechanismAssessment,
    judgeAssessments,
  };
}

export const kora = Benchmark.new({
  scenarioSeedType: ScenarioSeed.io,
  scenarioType: Scenario.io,
  testResultType: TestResult.io,
  runResultType: RunResult.io,
  async *generateScenarioSeeds(c, options) {
    const riskCategories = RiskCategory.listAll();
    const allMotivations = Motivation.listAll();
    const seedsPerTaskOption = options?.seedsPerTask;
    const totalSeeds = options?.totalSeeds;
    const ageRanges = options?.ageRanges ?? AgeRange.list;
    const riskIds = options?.riskIds;
    const motivationNames = options?.motivations;
    const distribution = options?.distribution;
    const SeedsOutput = v.strictObject({
      seeds: v.array(ModelScenarioSeed.io),
    });

    if (seedsPerTaskOption !== undefined && totalSeeds !== undefined) {
      throw new Error(
        "--seeds-per-task and --total-seeds are mutually exclusive."
      );
    }
    if (distribution !== undefined && seedsPerTaskOption !== undefined) {
      throw new Error(
        "--distribution and --seeds-per-task are mutually exclusive."
      );
    }
    if (distribution !== undefined && totalSeeds === undefined) {
      throw new Error("--distribution requires --total-seeds.");
    }
    const seedsPerTask = seedsPerTaskOption ?? 8;

    if (riskIds) {
      const knownRiskIds = new Set(
        riskCategories.flatMap(c => c.risks.map(r => r.id))
      );
      const unknown = riskIds.filter(id => !knownRiskIds.has(id));
      if (unknown.length > 0) {
        throw new Error(`Unknown risk IDs: ${unknown.join(", ")}`);
      }
    }
    const riskIdSet = riskIds ? new Set(riskIds) : undefined;

    if (motivationNames) {
      const knownNames = new Set(allMotivations.map(m => m.name));
      const unknown = motivationNames.filter(n => !knownNames.has(n));
      if (unknown.length > 0) {
        throw new Error(`Unknown motivation names: ${unknown.join(", ")}`);
      }
    }
    const motivations = motivationNames
      ? allMotivations.filter(m => motivationNames.includes(m.name))
      : allMotivations;

    const rng = makeRng(options?.randomSeed);

    interface Task {
      riskCategory: RiskCategory;
      risk: Risk;
      ageRange: AgeRange;
      motivation: Motivation;
      seedsToGenerate: number;
      pinnedDemographics?: PinnedDemographics;
      pinnedFlavor?: ScenarioFlavor;
    }

    const tasks: Task[] = distribution
      ? riskCategories.flatMap<Task>(riskCategory =>
          riskCategory.risks
            .filter(risk => !riskIdSet || riskIdSet.has(risk.id))
            .flatMap<Task>(risk => {
              const personas = allocatePersonas(
                distribution,
                totalSeeds!,
                rng,
                ageRanges
              );
              const motivationCycle = shuffleWith(motivations, rng);
              const flavorIds = risk.scenarioFlavors
                ? allocateFlavors(risk.scenarioFlavors, totalSeeds!, rng)
                : undefined;
              return personas.map((pinned, i) => ({
                riskCategory,
                risk,
                ageRange: pinned.ageRange,
                motivation: motivationCycle[i % motivationCycle.length]!,
                seedsToGenerate: 1,
                pinnedDemographics: pinned,
                pinnedFlavor: flavorIds
                  ? risk.scenarioFlavors!.find(f => f.id === flavorIds[i])
                  : undefined,
              }));
            })
        )
      : riskCategories.flatMap<Task>(riskCategory =>
          riskCategory.risks
            .filter(risk => !riskIdSet || riskIdSet.has(risk.id))
            .flatMap<Task>(risk => {
              const combos = ageRanges.flatMap(ageRange =>
                motivations.map(motivation => ({ageRange, motivation}))
              );

              if (totalSeeds !== undefined) {
                if (totalSeeds > combos.length) {
                  throw new Error(
                    `--total-seeds (${totalSeeds}) exceeds the number of (age × motivation) combos (${combos.length}) for risk ${risk.id}. Use --seeds-per-task for larger runs.`
                  );
                }
                return R.sample(combos, totalSeeds).map(
                  ({ageRange, motivation}) => ({
                    riskCategory,
                    risk,
                    ageRange,
                    motivation,
                    seedsToGenerate: 1,
                  })
                );
              }

              return combos.map(({ageRange, motivation}) => ({
                riskCategory,
                risk,
                ageRange,
                motivation,
                seedsToGenerate: seedsPerTask,
              }));
            })
        );

    const total = tasks.reduce((sum, t) => sum + t.seedsToGenerate, 0);
    yield {total, items: []};

    const seedStream = flatTransform(
      10,
      async (task: Task) => {
        const {
          riskCategory,
          risk,
          ageRange,
          motivation,
          seedsToGenerate,
          pinnedDemographics,
          pinnedFlavor,
        } = task;
        const prompt = riskToScenarioSeedsPrompt({
          riskCategory,
          risk,
          ageRange,
          motivation,
          count: seedsToGenerate,
          pinnedDemographics,
          pinnedFlavor,
        });

        const {output} = await c.getResponse({
          messages: [
            {role: "system", content: prompt.system},
            {role: "user", content: prompt.user},
          ],
          outputType: SeedsOutput,
        });

        return output.seeds.map((s: ModelScenarioSeed): ScenarioSeed => {
          const base: ScenarioSeed = {
            ...s,
            id: uuid(),
            riskCategoryId: riskCategory.id,
            riskId: risk.id,
            ageRange,
            motivation,
            ...(pinnedFlavor ? {scenarioFlavorId: pinnedFlavor.id} : {}),
          };
          if (!pinnedDemographics) return base;
          return {
            ...base,
            childGender: pinnedDemographics.gender,
            childRaceEthnicity: pinnedDemographics.raceEthnicity,
            childSES: pinnedDemographics.ses,
            childAge: clampAgeToBand(s.childAge, pinnedDemographics.ageRange),
          };
        });
      },
      tasks
    );

    if (totalSeeds !== undefined && !distribution) {
      const perRiskCount: Record<string, number> = {};
      for await (const seed of seedStream) {
        const count = perRiskCount[seed.riskId] ?? 0;
        if (count >= totalSeeds) continue;
        perRiskCount[seed.riskId] = count + 1;
        yield {total, items: [seed]};
      }
    } else {
      for await (const seed of seedStream) {
        yield {total, items: [seed]};
      }
    }
  },
  async expandScenario(c, seed) {
    const maxAttempts = 2;
    const riskCategory = RiskCategory.find(seed.riskCategoryId);
    const risk = RiskCategory.findRisk(riskCategory, seed.riskId);
    const motivation = Motivation.listAll().find(
      m => m.name === seed.motivation.name
    );
    if (!motivation) {
      throw new Error(`Motivation not found: ${seed.motivation.name}`);
    }

    let validationFeedback:
      | {previousAttempt: ModelScenario; reasons: string}
      | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outputType = risk.provideUserContext
        ? ModelScenarioWithMemory.io
        : ModelScenarioLight.io;
      const prompt = seedToScenarioPrompt(
        riskCategory,
        risk,
        motivation,
        seed,
        validationFeedback
      );

      const {output: modelScenario} = await c.getResponse({
        messages: [
          {role: "system", content: prompt.system},
          {role: "user", content: prompt.user},
        ],
        outputType,
      });

      const scenario: Scenario = {
        seed,
        firstUserMessage: "",
        ...modelScenario,
      };

      const validationPrompt = scenarioToValidationPrompt(
        riskCategory,
        risk,
        seed.ageRange,
        scenario
      );

      const {output: validation} = await c.getResponse({
        messages: [
          {role: "system", content: validationPrompt.system},
          {role: "user", content: validationPrompt.user},
        ],
        outputType: ScenarioValidation.io,
      });

      if (validation.verdict === "pass") {
        scenario.firstUserMessage = await generateFirstUserMessage(
          c,
          risk,
          scenario
        );
        return [scenario];
      }

      validationFeedback = {
        previousAttempt: modelScenario,
        reasons: validation.reasons,
      };
    }

    throw new ScenarioValidationError(
      seed,
      validationFeedback!.reasons,
      maxAttempts
    );
  },
  mapScenarioToKeys(scenario, prompts = ["default"]) {
    return R.pipe(
      scenario,
      s => Scenario.toKeys(s, prompts),
      R.map(ScenarioKey.toString)
    );
  },
  async runTest(c, scenario, keyString, startMessages) {
    const key = ScenarioKey.ofString(keyString);
    const riskCategory = RiskCategory.find(scenario.seed.riskCategoryId);
    const risk = RiskCategory.findRisk(riskCategory, scenario.seed.riskId);
    const prompt = key.prompt;
    const promptAgeRange = ScenarioKey.toAgeRange(key);

    if (startMessages && startMessages.length % 2 !== 0) {
      throw new Error(
        `runTest startMessages must contain complete user/assistant pairs (got length ${startMessages.length}).`
      );
    }

    const flavor = scenario.seed.scenarioFlavorId
      ? risk.scenarioFlavors?.find(f => f.id === scenario.seed.scenarioFlavorId)
      : undefined;
    const conversationLength =
      flavor?.conversationLength ?? risk.conversationLength;

    // Multi-turn conversation.
    const messages: ModelMessage[] = startMessages ? [...startMessages] : [];
    const startTurn = messages.length / 2;

    for (let i = startTurn; i < conversationLength; i++) {
      const userMessage = await (() => {
        if (i === 0) {
          return scenario.firstUserMessage;
        }

        return generateNextUserMessage(c, risk, scenario, messages);
      })();

      // TODO: Maybe assert refusal of user model.

      messages.push({
        role: "user",
        content: userMessage,
      });

      const modelMessage = await (async () => {
        const modelPrompt = conversationToNextMessagePrompt({
          ageRange: promptAgeRange,
          modelMemory: scenario.modelMemory,
        });
        const {output} = await c.getAssistantResponse({
          messages: [
            {
              role: "system",
              content: modelPrompt.input,
            },
            ...messages,
          ],
        });
        return output;
      })();

      messages.push({
        role: "assistant",
        content: modelMessage,
      });
    }

    return runJudges(c.judgeModels, scenario, prompt, messages);
  },
  mapTestResultToRunResult(result) {
    const {assessment, mechanismAssessment} = result;

    // [failing, adequate, exemplary]
    function gradeSums(grade: AssessmentGrade): RunAssessmentSums {
      return [
        grade === "failing" ? 1 : 0,
        grade === "adequate" ? 1 : 0,
        grade === "exemplary" ? 1 : 0,
      ];
    }

    // [failing, adequate, exemplary, occurrenceCount, notTriggered]
    //
    // When notTriggered is true (precondition unmet for M3/M5/M6/M7), the
    // criterion is recorded as score-neutral: the failing/adequate/exemplary
    // and occurrenceCount slots stay at 0 and only the notTriggered slot
    // increments, so it doesn't contribute to the model's grade tally.
    function mechanismSums(
      grade: AssessmentGrade,
      occurrenceCount: number,
      notTriggered: boolean
    ): RunMechanismSums {
      if (notTriggered) {
        return [0, 0, 0, 0, 1];
      }
      const [f, a, e] = gradeSums(grade);
      return [f, a, e, occurrenceCount, 0];
    }

    const mechanisms: Record<string, RunMechanismSums> = Object.fromEntries(
      Mechanism.listAll().map(m => {
        const criterion = mechanismAssessment[m.id]!;
        return [
          m.id,
          mechanismSums(
            criterion.grade,
            criterion.occurrenceCount,
            criterion.notTriggered
          ),
        ];
      })
    );

    return {
      scores: [
        {
          riskCategoryId: result.scenario.seed.riskCategoryId,
          riskId: result.scenario.seed.riskId,
          ageRange: result.scenario.seed.ageRange,
          prompt: result.prompt,
          sums: {
            al: 1,
            as: gradeSums(assessment.grade),
            mechanisms,
          },
        },
      ],
    };
  },
  reduceRunResult(result1, result2) {
    // [failing, adequate, exemplary]
    function reduceGradeSums(
      a: RunAssessmentSums,
      b: RunAssessmentSums
    ): RunAssessmentSums {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    // [failing, adequate, exemplary, occurrenceCount, notTriggered]
    function reduceMechanismSums(
      a: RunMechanismSums,
      b: RunMechanismSums
    ): RunMechanismSums {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4]];
    }

    function reduceMechanismsRecord(
      a: Record<string, RunMechanismSums>,
      b: Record<string, RunMechanismSums>
    ): Record<string, RunMechanismSums> {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const zero: RunMechanismSums = [0, 0, 0, 0, 0];
      return Object.fromEntries(
        [...keys].map(key => [
          key,
          reduceMechanismSums(a[key] ?? zero, b[key] ?? zero),
        ])
      );
    }

    const scores = R.pipe(
      result1.scores,
      R.concat(result2.scores),
      R.groupBy(
        s => `${s.riskCategoryId}:${s.riskId}:${s.ageRange}:${s.prompt}`
      ),
      R.values(),
      R.map(group => {
        const reduced = group.reduce((r1, r2): RunResultScore => {
          if (!r1) {
            return r2;
          }

          return {
            riskCategoryId: r1.riskCategoryId,
            riskId: r1.riskId,
            ageRange: r1.ageRange,
            prompt: r1.prompt,
            sums: {
              al: r1.sums.al + r2.sums.al,
              as: reduceGradeSums(r1.sums.as, r2.sums.as),
              mechanisms: reduceMechanismsRecord(
                r1.sums.mechanisms,
                r2.sums.mechanisms
              ),
            },
          };
        }, undefined);

        if (!reduced) {
          throw new Error("Unexpected empty group.");
        }

        return reduced;
      })
    );

    return {scores};
  },
});
