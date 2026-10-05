import {ValidationAnswer} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as R from "remeda";
import {
  PopulationRow,
  ValidationAttempt,
  ValidationPaths,
  ValidationStage,
} from "./validationLedger.js";

//
// Pass-rate report.
//
// Tallies a validation ledger per risk and per age group. A "slot" is one key
// of the ledger: a seed slot at seed generation, a seed at expansion.
//

export interface PassRateRow {
  group: string;
  /** Keys with at least one verdict. */
  slots: number;
  /** Keys whose first attempt passed. */
  firstAttemptPassed: number;
  /** Keys with a pass, on any attempt. */
  passed: number;
  /** Keys with no pass yet. */
  stuck: number;
  firstAttemptPassRate: number;
  passRate: number;
  /** Attempts per key, up to and including its first pass. */
  meanAttempts: number;
}

export interface StuckSlot {
  key: string;
  attempts: number;
  population: PopulationRow;
  lastReasons: string;
}

export interface PassRateReport {
  stage: ValidationStage;
  /** "blocked" while a key has no pass. */
  status: "complete" | "blocked";
  validatorModels: readonly string[];
  overall: PassRateRow;
  byRisk: readonly PassRateRow[];
  byAgeRange: readonly PassRateRow[];
  /** Rejections in which each yes/no question was answered no. */
  failedQuestions: Record<string, number>;
  /** Slots whose pass came with the child-voice check relaxed (temporary). */
  childVoiceRelaxedPasses: number;
  /** Of those, slots that passed only because of it: the question said no. */
  childVoiceWaivedPasses: number;
  stuck: readonly StuckSlot[];
}

interface SlotOutcome {
  key: string;
  /** Attempts counted for the slot: up to its first pass, or all of them. */
  attempts: readonly ValidationAttempt[];
  passed: boolean;
  firstAttemptPassed: boolean;
}

function slotOutcomes(rows: readonly ValidationAttempt[]): SlotOutcome[] {
  return R.pipe(
    rows,
    R.groupBy(row => row.key),
    R.entries(),
    R.map(([key, slotRows]) => {
      const ordered = R.sortBy(slotRows, row => row.attempt);
      const firstPass = ordered.findIndex(row => row.verdict === "pass");
      return {
        key,
        // A crash between a pass and its cache write makes the slot run again:
        // whatever follows the first pass is not counted.
        attempts: firstPass === -1 ? ordered : ordered.slice(0, firstPass + 1),
        passed: firstPass !== -1,
        firstAttemptPassed: firstPass === 0,
      };
    })
  );
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function tallyOutcomes(
  group: string,
  outcomes: readonly SlotOutcome[]
): PassRateRow {
  const slots = outcomes.length;
  const passed = outcomes.filter(o => o.passed).length;
  const firstAttemptPassed = outcomes.filter(o => o.firstAttemptPassed).length;
  return {
    group,
    slots,
    firstAttemptPassed,
    passed,
    stuck: slots - passed,
    firstAttemptPassRate: rate(firstAttemptPassed, slots),
    passRate: rate(passed, slots),
    meanAttempts: rate(
      R.sumBy(outcomes, o => o.attempts.length),
      slots
    ),
  };
}

/** One row per value of `groupOf`, sorted by group. */
export function tallyPassRates(
  rows: readonly ValidationAttempt[],
  groupOf: (row: ValidationAttempt) => string
): PassRateRow[] {
  return R.pipe(
    slotOutcomes(rows),
    R.groupBy(outcome => groupOf(outcome.attempts[0]!)),
    R.entries(),
    R.map(([group, outcomes]) => tallyOutcomes(group, outcomes)),
    R.sortBy(row => row.group)
  );
}

function reasonsOf(row: ValidationAttempt): string {
  return (
    row.reasons ??
    ValidationAnswer.failedReasons(row.questions ?? {}).join(" | ")
  );
}

export function buildPassRateReport(args: {
  stage: ValidationStage;
  rows: readonly ValidationAttempt[];
}): PassRateReport {
  const rows = args.rows.filter(row => row.stage === args.stage);
  const outcomes = slotOutcomes(rows);
  const stuck = outcomes
    .filter(outcome => !outcome.passed)
    .map(outcome => {
      const last = outcome.attempts.at(-1)!;
      return {
        key: outcome.key,
        attempts: outcome.attempts.length,
        population: last.population,
        lastReasons: reasonsOf(last),
      };
    });
  const failures = outcomes
    .flatMap(outcome => outcome.attempts)
    .filter(row => row.verdict === "fail");
  const relaxedPasses = outcomes
    .filter(outcome => outcome.passed)
    .map(outcome => outcome.attempts.at(-1)!)
    .filter(row => row.childVoiceRelaxed);

  return {
    stage: args.stage,
    status: stuck.length > 0 ? "blocked" : "complete",
    validatorModels: R.unique(rows.map(row => row.validatorModel)),
    overall: tallyOutcomes("all", outcomes),
    byRisk: tallyPassRates(rows, row => row.population.riskId),
    byAgeRange: tallyPassRates(rows, row => row.population.ageRange),
    failedQuestions: Object.fromEntries(
      R.unique(rows.flatMap(row => Object.keys(row.questions ?? {}))).map(
        question => [
          question,
          failures.filter(row => row.questions?.[question]?.answer === "no")
            .length,
        ]
      )
    ),
    childVoiceRelaxedPasses: relaxedPasses.length,
    childVoiceWaivedPasses: relaxedPasses.filter(
      row => row.questions?.childWouldWrite?.answer === "no"
    ).length,
    stuck,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function table(title: string, rows: readonly PassRateRow[]): string {
  return [
    `| ${title} | Slots | First-attempt pass | Pass | Stuck | Mean attempts |`,
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      row =>
        `| ${row.group} | ${row.slots} | ${row.firstAttemptPassed} (${percent(row.firstAttemptPassRate)}) | ${row.passed} (${percent(row.passRate)}) | ${row.stuck} | ${row.meanAttempts.toFixed(2)} |`
    ),
  ].join("\n");
}

/** The report as Markdown: what is written next to the output and printed. */
export function formatPassRateReport(report: PassRateReport): string {
  const title =
    report.stage === "seed"
      ? "Seed plausibility check"
      : "Scenario validation (after expansion)";
  const failedQuestions =
    Object.keys(report.failedQuestions).length > 0
      ? [
          "## Rejections per question",
          "",
          "| Question | Rejections answering no |",
          "| --- | ---: |",
          ...Object.entries(report.failedQuestions).map(
            ([question, count]) => `| ${question} | ${count} |`
          ),
          "",
        ]
      : [];
  const relaxed =
    report.childVoiceRelaxedPasses > 0
      ? [
          "## Child-voice check relaxed (temporary)",
          "",
          `${report.childVoiceRelaxedPasses} slot(s) passed with the child-voice check relaxed after repeated rejections; ${report.childVoiceWaivedPasses} of them with the first message still judged not to sound like the child's age.`,
          "",
        ]
      : [];
  const stuck =
    report.stuck.length > 0
      ? [
          "## Stuck",
          "",
          ...report.stuck.map(
            slot =>
              `- ${slot.key} (${slot.population.riskId}, ${slot.population.ageRange}${slot.population.situationType ? `, ${slot.population.situationType}` : ""}; ${slot.attempts} attempts): ${slot.lastReasons}`
          ),
          "",
        ]
      : [];

  return [
    `# ${title}: pass rates`,
    "",
    `Status: ${report.status}. Validator: ${report.validatorModels.join(", ") || "none"}.`,
    "A slot passes on the first attempt, passes after being written again, or is stuck (no pass yet).",
    "",
    table("Overall", [report.overall]),
    "",
    "## Per risk",
    "",
    table("Risk", report.byRisk),
    "",
    "## Per age group",
    "",
    table("Age group", report.byAgeRange),
    "",
    ...failedQuestions,
    ...relaxed,
    ...stuck,
  ].join("\n");
}

export async function writePassRateReport(
  paths: ValidationPaths,
  report: PassRateReport
): Promise<void> {
  await fs.writeFile(paths.reportMd, formatPassRateReport(report));
  await fs.writeFile(paths.reportJson, JSON.stringify(report, null, 2) + "\n");
}
