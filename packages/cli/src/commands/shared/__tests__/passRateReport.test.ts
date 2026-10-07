import {SeedValidation} from "@korabench/benchmark";
import {describe, expect, it} from "vitest";
import {
  buildPassRateReport,
  formatPassRateReport,
  tallyPassRates,
} from "../passRateReport.js";
import {PopulationRow, ValidationAttempt} from "../validationLedger.js";

function population(riskId: string, ageRange: string): PopulationRow {
  return {
    riskCategoryId: "category",
    riskId,
    ageRange,
    childAge: 11,
    childGender: "girl",
    childRaceEthnicity: "white",
    motivation: "Curiosity",
    socialContext: "alone",
    riskSignalType: "subtle",
    private: false,
  };
}

function questions(failed?: "showsUse" | "addressesAI"): SeedValidation {
  const yes = {reason: "Fine.", answer: "yes" as const};
  const no = {reason: "Clear problem.", answer: "no" as const};
  return {
    plausibleForChild: yes,
    matchesSituation: yes,
    showsMotivation: yes,
    showsUse: failed === "showsUse" ? no : yes,
    addressesAI: failed === "addressesAI" ? no : yes,
  };
}

function attempt(
  key: string,
  n: number,
  verdict: "pass" | "fail",
  riskId: string,
  ageRange: string,
  failed: "showsUse" | "addressesAI" = "showsUse"
): ValidationAttempt {
  return {
    stage: "seed",
    key,
    seedId: `${key}-${n}`,
    attempt: n,
    verdict,
    questions: questions(verdict === "fail" ? failed : undefined),
    generatorModel: "generator",
    validatorModel: "validator",
    population: population(riskId, ageRange),
    at: "2026-10-05T00:00:00.000Z",
  };
}

// r1: a passes first, b passes on its second attempt, c is stuck after three.
// r2: d passes first.
const rows: ValidationAttempt[] = [
  attempt("a", 1, "pass", "r1", "7to9"),
  attempt("b", 1, "fail", "r1", "7to9"),
  attempt("b", 2, "pass", "r1", "7to9"),
  attempt("c", 1, "fail", "r1", "13to17", "addressesAI"),
  attempt("c", 2, "fail", "r1", "13to17", "addressesAI"),
  attempt("c", 3, "fail", "r1", "13to17", "addressesAI"),
  attempt("d", 1, "pass", "r2", "13to17"),
];

describe("tallyPassRates", () => {
  it("counts first-attempt passes, passes, stuck slots and attempts per group", () => {
    expect(tallyPassRates(rows, row => row.population.riskId)).toEqual([
      {
        group: "r1",
        slots: 3,
        firstAttemptPassed: 1,
        passed: 2,
        stuck: 1,
        firstAttemptPassRate: 1 / 3,
        passRate: 2 / 3,
        meanAttempts: 2,
      },
      {
        group: "r2",
        slots: 1,
        firstAttemptPassed: 1,
        passed: 1,
        stuck: 0,
        firstAttemptPassRate: 1,
        passRate: 1,
        meanAttempts: 1,
      },
    ]);
  });

  it("ignores what follows the first pass of a slot", () => {
    const rerun = [...rows, attempt("a", 2, "fail", "r1", "7to9")];
    expect(tallyPassRates(rerun, row => row.population.riskId)).toEqual(
      tallyPassRates(rows, row => row.population.riskId)
    );
  });
});

describe("buildPassRateReport", () => {
  const report = buildPassRateReport({stage: "seed", rows});

  it("is blocked while a slot has no pass, and names it with its reasons", () => {
    expect(report.status).toBe("blocked");
    expect(report.stuck).toEqual([
      {
        key: "c",
        attempts: 3,
        population: population("r1", "13to17"),
        lastReasons: "addressesAI: Clear problem.",
      },
    ]);
    expect(
      buildPassRateReport({
        stage: "seed",
        rows: rows.filter(row => row.key !== "c"),
      }).status
    ).toBe("complete");
  });

  it("tallies overall, per risk and per age group", () => {
    expect(report.overall).toMatchObject({slots: 4, passed: 3, stuck: 1});
    expect(report.byRisk.map(row => row.group)).toEqual(["r1", "r2"]);
    expect(
      report.byAgeRange.map(row => [row.group, row.slots, row.passed])
    ).toEqual([
      ["13to17", 2, 1],
      ["7to9", 2, 2],
    ]);
  });

  it("counts the rejections each question caused", () => {
    expect(report.failedQuestions).toEqual({
      plausibleForChild: 0,
      matchesSituation: 0,
      showsMotivation: 0,
      showsUse: 1,
      addressesAI: 3,
    });
  });

  it("keeps the stages apart and reports expansion reasons as given", () => {
    const expansion = buildPassRateReport({
      stage: "expansion",
      rows: [
        ...rows,
        {
          ...attempt("s", 1, "fail", "r1", "7to9"),
          stage: "expansion",
          questions: {
            childWouldWrite: {reason: "Reads like an adult.", answer: "no"},
          },
          reasons: "childWouldWrite: Reads like an adult.",
        },
      ],
    });
    expect(expansion.overall.slots).toBe(1);
    expect(expansion.failedQuestions).toEqual({childWouldWrite: 1});
    expect(expansion.stuck[0]!.lastReasons).toBe(
      "childWouldWrite: Reads like an adult."
    );
  });

  it("counts the passes that came with the child-voice check relaxed", () => {
    const expansionAttempt = (
      key: string,
      n: number,
      verdict: "pass" | "fail",
      answer: "yes" | "no",
      relaxed: boolean
    ): ValidationAttempt => ({
      ...attempt(key, n, verdict, "r1", "7to9"),
      stage: "expansion",
      questions: {childWouldWrite: {reason: "As judged.", answer}},
      ...(relaxed ? {childVoiceRelaxed: true as const} : {}),
    });
    const expansion = buildPassRateReport({
      stage: "expansion",
      rows: [
        // Passed only because the check was relaxed.
        expansionAttempt("s", 1, "fail", "no", false),
        expansionAttempt("s", 2, "pass", "no", true),
        // Relaxed, but the message was fine by then.
        expansionAttempt("t", 1, "fail", "no", false),
        expansionAttempt("t", 2, "pass", "yes", true),
        expansionAttempt("u", 1, "pass", "yes", false),
      ],
    });

    expect(expansion.childVoiceRelaxedPasses).toBe(2);
    expect(expansion.childVoiceWaivedPasses).toBe(1);
    expect(formatPassRateReport(expansion)).toContain(
      "2 slot(s) passed with the child-voice check relaxed"
    );
    expect(formatPassRateReport(report)).not.toContain("Child-voice");
  });

  it("lists the slots that passed after their risk signal type was relabeled", () => {
    const relabeled = (
      key: string,
      n: number,
      verdict: "pass" | "fail",
      from?: "ambiguous"
    ): ValidationAttempt => ({
      ...attempt(key, n, verdict, "r1", "7to9"),
      stage: "expansion",
      ...(from ? {relabeledFrom: from} : {}),
    });
    const expansion = buildPassRateReport({
      stage: "expansion",
      rows: [
        relabeled("s", 1, "fail"),
        relabeled("s", 2, "fail"),
        relabeled("s", 3, "pass", "ambiguous"),
        relabeled("t", 1, "pass"),
      ],
    });
    expect(expansion.relabeledPasses).toEqual([
      {
        key: "s",
        dimension: "riskSignalType",
        from: "ambiguous",
        to: "subtle",
        attempts: 3,
      },
    ]);
    expect(formatPassRateReport(expansion)).toContain(
      "- s: riskSignalType ambiguous → subtle (3 attempts)"
    );
    expect(formatPassRateReport(report)).not.toContain("Relabeled");

    const useRelabeled: ValidationAttempt = {
      ...attempt("u", 2, "pass", "r1", "7to9"),
      stage: "expansion",
      relabeled: {use: {from: "learning"}},
      population: {...population("r1", "7to9"), use: "health_advice"},
    };
    const both = buildPassRateReport({
      stage: "expansion",
      rows: [relabeled("u", 1, "fail"), useRelabeled],
    });
    expect(both.relabeledPasses).toEqual([
      {
        key: "u",
        dimension: "use",
        from: "learning",
        to: "health_advice",
        attempts: 2,
      },
    ]);
  });

  it("renders the tables as Markdown", () => {
    const markdown = formatPassRateReport(report);
    expect(markdown).toContain("# Seed plausibility check: pass rates");
    expect(markdown).toContain("| r1 | 3 | 1 (33.3%) | 2 (66.7%) | 1 | 2.00 |");
    expect(markdown).toContain(
      "| 7to9 | 2 | 1 (50.0%) | 2 (100.0%) | 0 | 1.50 |"
    );
    expect(markdown).toContain("| addressesAI | 3 |");
    expect(markdown).toContain("- c (r1, 13to17; 3 attempts): addressesAI");
  });
});
