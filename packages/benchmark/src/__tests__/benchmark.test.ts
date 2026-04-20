import {describe, expect, it} from "vitest";
import {kora} from "../kora.js";
import {AgeRange} from "../model/ageRange.js";
import {AssessmentGrade} from "../model/assessmentGrade.js";
import {Mechanism} from "../model/mechanism.js";
import {
  MechanismAssessment,
  MechanismCriterionAssessment,
} from "../model/mechanismAssessment.js";
import {RunMechanismSums, RunResult} from "../model/runResult.js";
import {ScenarioPrompt} from "../model/scenarioKey.js";
import {TestResult} from "../model/testResult.js";

//
// Test fixtures.
//

function makeCriterion(
  grade: AssessmentGrade = "adequate",
  occurrenceCount = 0
): MechanismCriterionAssessment {
  return {
    grade,
    occurrenceCount,
    reasons: `Criterion reasons placeholder — graded as ${grade} with ${occurrenceCount} occurrences in the conversation under evaluation.`,
  };
}

function makeMechanismAssessment(): MechanismAssessment {
  return Object.fromEntries(
    Mechanism.listAll().map(m => [m.id, makeCriterion()])
  );
}

function createTestResult(
  overrides: Partial<{
    riskCategoryId: string;
    riskId: string;
    ageRange: AgeRange;
    prompt: ScenarioPrompt;
    grade: AssessmentGrade;
  }> = {}
): TestResult {
  const {
    riskCategoryId = "risk-cat-1",
    riskId = "risk-1",
    ageRange = "7to9",
    prompt = "child",
    grade = "adequate",
  } = overrides;

  const mechanismAssessment = makeMechanismAssessment();

  return {
    scenario: {
      shortTitle: "Test scenario title",
      childMaturity:
        "A child with moderate emotional development and typical cognitive abilities for their age.",
      childBackground:
        "A child from a middle-class suburban family with supportive parents and stable home environment.",
      narrative:
        "The child is curious about the world and asks many questions. They are learning to navigate social situations and understand complex topics.",
      firstUserMessage: "Hello, can you help me?",
      evaluationCriteria:
        "The response addresses the child appropriately for their developmental stage and provides age-appropriate information.",
      seed: {
        id: "seed-1",
        riskCategoryId,
        riskId,
        ageRange,
        motivation: {name: "curiosity", description: "Driven by curiosity"},
        childAge: 8,
        childGender: "male",
        childRaceEthnicity: "asian",
        childCognitiveMaturity: "medium",
        childEmotionalMaturity: "medium",
        shortTitle: "Test seed title",
        riskSignalType: "subtle",
        coreBehavior: "A child exploring boundaries in conversation.",
        socialContext: "alone",
        context: "Child is home alone and curious about topics.",
        notes: "",
      },
    },
    prompt,
    messages: [
      {role: "user", content: "Hello, can you help me?"},
      {role: "assistant", content: "Of course! How can I help you today?"},
    ],
    assessment: {
      grade,
      reasons:
        "The assistant responded appropriately to the child's request, maintaining a helpful and supportive tone throughout the conversation while being mindful of the child's age.",
    },
    mechanismAssessment,
    judgeAssessments: [
      {
        judgeModelSlug: "custom-llm",
        assessment: {
          grade,
          reasons:
            "The assistant responded appropriately to the child's request, maintaining a helpful and supportive tone throughout the conversation while being mindful of the child's age.",
        },
        mechanismAssessment,
      },
    ],
  };
}

// [failing, adequate, exemplary]
type GradeSums = [number, number, number];

function zeroMechanismSums(): Record<string, RunMechanismSums> {
  return Object.fromEntries(
    Mechanism.listAll().map(m => [m.id, [0, 0, 0, 0] as RunMechanismSums])
  );
}

function createRunResult(
  scores: Array<{
    riskCategoryId: string;
    riskId: string;
    ageRange: AgeRange;
    prompt: ScenarioPrompt;
    sums: {
      al: number;
      as: GradeSums;
      mechanisms: Record<string, RunMechanismSums>;
    };
  }>
): RunResult {
  return {scores};
}

function createSums(assessment: GradeSums, al: number = 1) {
  return {
    al,
    as: assessment,
    mechanisms: zeroMechanismSums(),
  };
}

//
// Tests.
//

describe("benchmark.mapTestResultToRunResult", () => {
  it("maps a test result with adequate grade to run result scores", () => {
    const testResult = createTestResult({grade: "adequate"});

    const runResult = kora.mapTestResultToRunResult(testResult);

    expect(runResult.scores).toHaveLength(1);
    expect(runResult.scores[0]).toMatchObject({
      riskCategoryId: "risk-cat-1",
      riskId: "risk-1",
      ageRange: "7to9",
      sums: {
        al: 1,
        as: [0, 1, 0], // [failing, adequate, exemplary]
      },
    });
  });

  it("maps a test result with failing grade to run result scores", () => {
    const testResult = createTestResult({grade: "failing"});

    const runResult = kora.mapTestResultToRunResult(testResult);

    expect(runResult.scores[0]?.sums).toMatchObject({
      al: 1,
      as: [1, 0, 0], // [failing, adequate, exemplary]
    });
  });

  it("maps a test result with exemplary grade to run result scores", () => {
    const testResult = createTestResult({grade: "exemplary"});

    const runResult = kora.mapTestResultToRunResult(testResult);

    expect(runResult.scores[0]?.sums).toMatchObject({
      al: 1,
      as: [0, 0, 1], // [failing, adequate, exemplary]
    });
  });

  it("emits sums.mechanisms with an entry for every declared mechanism", () => {
    const testResult = createTestResult({grade: "adequate"});

    const runResult = kora.mapTestResultToRunResult(testResult);

    const mechanisms = runResult.scores[0]!.sums.mechanisms;
    for (const mechanism of Mechanism.listAll()) {
      const sums = mechanisms[mechanism.id];
      expect(sums).toBeDefined();
      // All fixtures default to adequate with 0 occurrences.
      expect(sums).toEqual([0, 1, 0, 0]);
    }
  });

  it("preserves scenario metadata in the score", () => {
    const testResult = createTestResult({
      riskCategoryId: "custom-category",
      riskId: "custom-risk",
      ageRange: "13to17",
    });

    const runResult = kora.mapTestResultToRunResult(testResult);

    expect(runResult.scores[0]).toMatchObject({
      riskCategoryId: "custom-category",
      riskId: "custom-risk",
      ageRange: "13to17",
    });
  });
});

describe("benchmark.reduceRunResult", () => {
  it("combines two run results with different keys", () => {
    const result1 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([0, 1, 0]),
      },
    ]);
    const result2 = createRunResult([
      {
        riskCategoryId: "cat-2",
        riskId: "risk-2",
        ageRange: "10to12",
        prompt: "child",
        sums: createSums([1, 0, 0]),
      },
    ]);

    const reduced = kora.reduceRunResult(result1, result2);

    expect(reduced.scores).toHaveLength(2);
    expect(reduced.scores).toContainEqual(
      expect.objectContaining({
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
      })
    );
    expect(reduced.scores).toContainEqual(
      expect.objectContaining({
        riskCategoryId: "cat-2",
        riskId: "risk-2",
        ageRange: "10to12",
      })
    );
  });

  it("sums scores with the same grouping key", () => {
    const result1 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([1, 2, 0], 3),
      },
    ]);
    const result2 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([2, 1, 1], 4),
      },
    ]);

    const reduced = kora.reduceRunResult(result1, result2);

    expect(reduced.scores).toHaveLength(1);
    expect(reduced.scores[0]).toMatchObject({
      riskCategoryId: "cat-1",
      riskId: "risk-1",
      ageRange: "7to9",
      sums: {
        al: 7,
        as: [3, 3, 1], // [failing, adequate, exemplary]
      },
    });
  });

  it("handles mixed grouping keys correctly", () => {
    const result1 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([1, 0, 0]),
      },
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "10to12",
        prompt: "child",
        sums: createSums([0, 1, 0]),
      },
    ]);
    const result2 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([0, 0, 1]),
      },
    ]);

    const reduced = kora.reduceRunResult(result1, result2);

    expect(reduced.scores).toHaveLength(2);

    const score7to9 = reduced.scores.find(s => s.ageRange === "7to9");
    expect(score7to9?.sums).toMatchObject({
      al: 2,
      as: [1, 0, 1], // [failing, adequate, exemplary]
    });

    const score10to12 = reduced.scores.find(s => s.ageRange === "10to12");
    expect(score10to12?.sums).toMatchObject({
      al: 1,
      as: [0, 1, 0], // [failing, adequate, exemplary]
    });
  });

  it("sums mechanism counts across reduced scores", () => {
    const [firstId, ...rest] = Mechanism.listAll().map(m => m.id);
    if (!firstId) throw new Error("Expected at least one mechanism");

    const zeroRest = Object.fromEntries(
      rest.map(id => [id, [0, 0, 0, 0] as RunMechanismSums])
    );
    const customSums = (
      m: RunMechanismSums
    ): Record<string, RunMechanismSums> => ({
      [firstId]: m,
      ...zeroRest,
    });

    const result1 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: {
          al: 1,
          as: [0, 1, 0],
          mechanisms: customSums([1, 0, 0, 2]),
        },
      },
    ]);
    const result2 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: {
          al: 1,
          as: [0, 1, 0],
          mechanisms: customSums([0, 1, 0, 3]),
        },
      },
    ]);

    const reduced = kora.reduceRunResult(result1, result2);

    expect(reduced.scores[0]?.sums.mechanisms[firstId]).toEqual([1, 1, 0, 5]);
  });

  it("handles empty scores arrays", () => {
    const result1 = createRunResult([]);
    const result2 = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([0, 1, 0]),
      },
    ]);

    const reduced = kora.reduceRunResult(result1, result2);

    expect(reduced.scores).toHaveLength(1);
  });

  it("is associative - (a + b) + c equals a + (b + c)", () => {
    const a = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([1, 0, 0]),
      },
    ]);
    const b = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([0, 1, 0]),
      },
    ]);
    const c = createRunResult([
      {
        riskCategoryId: "cat-1",
        riskId: "risk-1",
        ageRange: "7to9",
        prompt: "child",
        sums: createSums([0, 0, 1]),
      },
    ]);

    const leftAssoc = kora.reduceRunResult(kora.reduceRunResult(a, b), c);
    const rightAssoc = kora.reduceRunResult(a, kora.reduceRunResult(b, c));

    expect(leftAssoc.scores[0]?.sums).toEqual(rightAssoc.scores[0]?.sums);
  });
});
