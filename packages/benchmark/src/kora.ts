import {ModelMessage} from "@korabench/core";
import * as R from "remeda";
import {flatTransform} from "streaming-iterables";
import {v4 as uuid} from "uuid";
import * as v from "valibot";
import {
  aggregateMechanismAssessments,
  aggregateTestAssessments,
} from "./aggregateAssessments.js";
import {Benchmark} from "./benchmark.js";
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
import {ScenarioKey} from "./model/scenarioKey.js";
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

export const kora = Benchmark.new({
  scenarioSeedType: ScenarioSeed.io,
  scenarioType: Scenario.io,
  testResultType: TestResult.io,
  runResultType: RunResult.io,
  async *generateScenarioSeeds(c, options) {
    const riskCategories = RiskCategory.listAll();
    const allMotivations = Motivation.listAll();
    const seedsPerTask = options?.seedsPerTask ?? 8;
    const ageRanges = options?.ageRanges ?? AgeRange.list;
    const riskIds = options?.riskIds;
    const motivationNames = options?.motivations;
    const SeedsOutput = v.strictObject({
      seeds: v.array(ModelScenarioSeed.io),
    });

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

    const tasks = riskCategories.flatMap(riskCategory =>
      riskCategory.risks
        .filter(risk => !riskIdSet || riskIdSet.has(risk.id))
        .flatMap(risk =>
          ageRanges.flatMap(ageRange =>
            motivations.map(motivation => ({
              riskCategory,
              risk,
              ageRange,
              motivation,
            }))
          )
        )
    );

    const total = tasks.length * seedsPerTask;
    yield {total, items: []};

    const seedStream = flatTransform(
      10,
      async ({riskCategory, risk, ageRange, motivation}) => {
        const prompt = riskToScenarioSeedsPrompt(
          riskCategory,
          risk,
          ageRange,
          motivation,
          seedsPerTask
        );

        const {output} = await c.getResponse({
          messages: [
            {role: "system", content: prompt.system},
            {role: "user", content: prompt.user},
          ],
          outputType: SeedsOutput,
        });

        return output.seeds.map(
          (s: ModelScenarioSeed): ScenarioSeed => ({
            ...s,
            id: uuid(),
            riskCategoryId: riskCategory.id,
            riskId: risk.id,
            ageRange,
            motivation,
          })
        );
      },
      tasks
    );

    for await (const seed of seedStream) {
      yield {total, items: [seed]};
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
  async runTest(c, scenario, keyString) {
    const key = ScenarioKey.ofString(keyString);
    const riskCategory = RiskCategory.find(scenario.seed.riskCategoryId);
    const risk = RiskCategory.findRisk(riskCategory, scenario.seed.riskId);
    const prompt = key.prompt;
    const promptAgeRange = ScenarioKey.toAgeRange(key);

    // Multi-turn conversation.
    const messages: ModelMessage[] = [];

    for (let i = 0; i < risk.conversationLength; i++) {
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

    // Build prompts once.
    const assessmentPrompt = conversationToAssessmentPrompt(
      risk,
      scenario,
      messages
    );
    const mechanismPrompt = conversationToMechanismAssessmentPrompt(
      scenario,
      messages
    );

    // Call all judges in parallel (safety + mechanisms per judge).
    const judgeSlugs = Object.keys(c.judgeModels);
    const judgeAssessments = await Promise.all(
      judgeSlugs.map(async (slug): Promise<JudgeAssessment> => {
        const judge = c.judgeModels[slug]!;

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

    // Aggregate across judges.
    const assessment = aggregateTestAssessments(
      judgeAssessments.map(j => j.assessment)
    );
    const mechanismAssessment = aggregateMechanismAssessments(
      judgeAssessments.map(j => j.mechanismAssessment)
    );

    return {
      scenario,
      prompt,
      messages,
      assessment,
      mechanismAssessment,
      judgeAssessments,
    };
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

    // [failing, adequate, exemplary, occurrenceCount]
    function mechanismSums(
      grade: AssessmentGrade,
      occurrenceCount: number
    ): RunMechanismSums {
      const [f, a, e] = gradeSums(grade);
      return [f, a, e, occurrenceCount];
    }

    const mechanisms: Record<string, RunMechanismSums> = Object.fromEntries(
      Mechanism.listAll().map(m => {
        const criterion = mechanismAssessment[m.id]!;
        return [
          m.id,
          mechanismSums(criterion.grade, criterion.occurrenceCount),
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

    // [failing, adequate, exemplary, occurrenceCount]
    function reduceMechanismSums(
      a: RunMechanismSums,
      b: RunMechanismSums
    ): RunMechanismSums {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
    }

    function reduceMechanismsRecord(
      a: Record<string, RunMechanismSums>,
      b: Record<string, RunMechanismSums>
    ): Record<string, RunMechanismSums> {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const zero: RunMechanismSums = [0, 0, 0, 0];
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
