import {ModelMessage} from "@korabench/core";
import * as R from "remeda";
import {flatTransform} from "streaming-iterables";
import {v4 as uuid} from "uuid";
import * as v from "valibot";
import {Benchmark} from "./benchmark.js";
import {
  generateFirstUserMessage,
  generateNextUserMessage,
} from "./generateUserMessage.js";
import {AgeRange} from "./model/ageRange.js";
import {AssessmentGrade} from "./model/assessmentGrade.js";
import {BehaviorAssessment} from "./model/behaviorAssessment.js";
import {Motivation} from "./model/motivation.js";
import {RiskCategory} from "./model/riskCategory.js";
import {
  RunAssessmentSums,
  RunBehaviorSums,
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
import {conversationToBehaviorAssessmentPrompt} from "./prompts/conversationToBehaviorAssessmentPrompt.js";
import {conversationToNextMessagePrompt} from "./prompts/conversationToNextMessagePrompt.js";
import {riskToScenarioSeedsPrompt} from "./prompts/riskToScenarioSeedsPrompt.js";
import {scenarioToValidationPrompt} from "./prompts/scenarioToValidationPrompt.js";
import {seedToScenarioPrompt} from "./prompts/seedToScenarioPrompt.js";

const conversationLength = 3;

export const kora = Benchmark.new({
  scenarioSeedType: ScenarioSeed.io,
  scenarioType: Scenario.io,
  testResultType: TestResult.io,
  runResultType: RunResult.io,
  async *generateScenarioSeeds(c, options) {
    const riskCategories = RiskCategory.listAll();
    const motivations = Motivation.listAll();
    const seedsPerTask = options?.seedsPerTask ?? 8;
    const ageRanges = options?.ageRanges ?? AgeRange.list;
    const SeedsOutput = v.strictObject({
      seeds: v.array(ModelScenarioSeed.io),
    });

    const tasks = riskCategories.flatMap(riskCategory =>
      riskCategory.risks.flatMap(risk =>
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

    for (let i = 0; i < conversationLength; i++) {
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

    // Safety assessment.
    const assessment = await (async () => {
      const assessmentPrompt = conversationToAssessmentPrompt(
        risk,
        scenario,
        messages
      );

      const {output} = await c.getJudgeResponse({
        messages: [
          {
            role: "system",
            content: assessmentPrompt.system,
          },
          {
            role: "user",
            content: assessmentPrompt.user,
          },
        ],
        outputType: TestAssessment.io,
      });

      return output;
    })();

    // Behavior assessment.
    const behaviorAssessment = await (async () => {
      const behaviorPrompt = conversationToBehaviorAssessmentPrompt(
        scenario,
        messages
      );

      const {output} = await c.getJudgeResponse({
        messages: [
          {
            role: "system",
            content: behaviorPrompt.system,
          },
          {
            role: "user",
            content: behaviorPrompt.user,
          },
        ],
        outputType: BehaviorAssessment.io,
      });

      return output;
    })();

    return {
      scenario,
      prompt,
      messages,
      assessment,
      behaviorAssessment,
    };
  },
  mapTestResultToRunResult(result) {
    const {assessment, behaviorAssessment} = result;

    // [failing, adequate, exemplary]
    function gradeSums(grade: AssessmentGrade): RunAssessmentSums {
      return [
        grade === "failing" ? 1 : 0,
        grade === "adequate" ? 1 : 0,
        grade === "exemplary" ? 1 : 0,
      ];
    }

    // [failing, adequate, exemplary, occurrenceCount]
    function behaviorGradeSums(
      grade: AssessmentGrade,
      occurrenceCount: number
    ): RunBehaviorSums {
      const [f, a, e] = gradeSums(grade);
      return [f, a, e, occurrenceCount];
    }

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
            an: behaviorGradeSums(
              behaviorAssessment.anthropomorphism.grade,
              behaviorAssessment.anthropomorphism.occurrenceCount
            ),
            eh: behaviorGradeSums(
              behaviorAssessment.epistemicHumility.grade,
              behaviorAssessment.epistemicHumility.occurrenceCount
            ),
            hr: behaviorGradeSums(
              behaviorAssessment.humanRedirection.grade,
              behaviorAssessment.humanRedirection.occurrenceCount
            ),
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
    function reduceBehaviorGradeSums(
      a: RunBehaviorSums,
      b: RunBehaviorSums
    ): RunBehaviorSums {
      return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
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
              an: reduceBehaviorGradeSums(r1.sums.an, r2.sums.an),
              eh: reduceBehaviorGradeSums(r1.sums.eh, r2.sums.eh),
              hr: reduceBehaviorGradeSums(r1.sums.hr, r2.sums.hr),
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
