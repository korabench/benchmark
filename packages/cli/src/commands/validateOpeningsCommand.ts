import {
  Packs,
  RiskTaxonomy,
  Scenario,
  ScenarioValidation,
  validateConfirmed,
  verdictsOf,
} from "@korabench/benchmark";
import {Script} from "@korabench/core";
import * as path from "node:path";
import * as R from "remeda";
import {consume, transform} from "streaming-iterables";
import {Program} from "../cli.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
  RoleOverrides,
} from "../profiles/effectiveProfile.js";
import {chainLabel, createChainModel} from "../profiles/roleModels.js";
import {readScenariosFromJsonl} from "./runCommand.js";
import {workSummary} from "./shared/executionSummary.js";
import {
  buildPassRateReport,
  formatPassRateReport,
  writePassRateReport,
} from "./shared/passRateReport.js";
import {isPrivatePath} from "./shared/privatePath.js";
import {resolveRiskIdFilter} from "./shared/riskFilters.js";
import {assertInputConforms} from "./shared/validateInputFile.js";
import {
  openLedger,
  populationRowOf,
  readLedger,
  type ValidationPaths,
} from "./shared/validationLedger.js";

//
// Validate openings.
//
// Runs the scenario validation of `expand-scenarios` (one call by the
// profile's expansion model) on every scenario of a corpus as it stands,
// opening included, and writes nothing else: for a corpus whose openings were
// written after expansion (`revise-openings` before it validated), to know
// which openings expansion would have rejected. Each verdict goes to a ledger
// next to the input, so a stopped run resumes; the report counts passes and
// the questions that failed.
//

/** `x/scenarios.jsonl` → `x/scenarios.openings-validation.private.jsonl` and
 * its report: apart from the expansion ledger of the same corpus. */
export function openingValidationPathsFor(
  inputFilePath: string
): ValidationPaths {
  const {dir, name} = path.parse(inputFilePath);
  return {
    ledger: path.join(dir, `${name}.openings-validation.private.jsonl`),
    reportMd: path.join(dir, `${name}.openings-validation-report.md`),
    reportJson: path.join(dir, `${name}.openings-validation-report.json`),
  };
}

export interface ValidateOpeningsOptions {
  riskIds?: readonly string[];
  concurrency?: number;
  /** Validate a rejected opening a second time (`validateConfirmed`).
   * Default true. */
  recheck?: boolean;
}

export async function validateOpeningsCommand(
  _program: Program,
  modelsJsonPath: string,
  overrides: RoleOverrides,
  inputFilePath: string,
  options: ValidateOpeningsOptions
) {
  const effective = resolveEffectiveProfile(modelsJsonPath, overrides);
  const {roles} = effective;
  const validatorLabel = chainLabel(roles.expansion);
  const validator = createChainModel(roles.expansion).model;
  console.log(`Profile: ${describeProfileRef(effective.ref)}`);
  console.log(`Validating openings with ${validatorLabel}...`);

  const total = await assertInputConforms(inputFilePath, "scenarios");
  console.log(
    `Validated ${total} scenario(s) against taxonomy "${RiskTaxonomy.label(Packs.current().taxonomy)}".`
  );
  const riskIdFilter = resolveRiskIdFilter(options.riskIds);
  const scenarios: Scenario[] = [];
  for await (const scenario of readScenariosFromJsonl(inputFilePath, {
    riskIds: riskIdFilter,
  })) {
    scenarios.push(scenario);
  }

  const paths = openingValidationPathsFor(inputFilePath);
  const prior = (await readLedger(paths.ledger)).filter(
    row => row.stage === "opening"
  );
  const done = new Set(prior.map(row => row.key));
  const pending = scenarios.filter(s => !done.has(s.seed.id));
  if (done.size > 0) {
    console.log(
      `Resuming: ${done.size} verdict(s) already in ${paths.ledger}.`
    );
  }
  const ledger = await openLedger(paths.ledger, {fresh: done.size === 0});
  const isPrivate = isPrivatePath(inputFilePath);

  const progress = Script.progress(scenarios.length, text =>
    process.stdout.write(text)
  );
  R.times(scenarios.length - pending.length, () => progress.increment(true));
  const failures: string[] = [];
  await consume(
    transform(
      options.concurrency ?? 10,
      async (scenario: Scenario) => {
        try {
          const confirmed = await validateConfirmed(
            {
              getResponse: async request => ({
                output: await validator.getStructuredResponse(request),
              }),
            },
            scenario,
            0,
            {recheck: options.recheck}
          );
          for (const {verdict, recheck} of verdictsOf(confirmed)) {
            await ledger.record({
              stage: "opening",
              key: scenario.seed.id,
              seedId: scenario.seed.id,
              verdict: verdict.verdict,
              questions: ScenarioValidation.questionsOf(verdict.validation),
              reasons: verdict.reasons,
              ...(recheck ? {recheck: true} : {}),
              generatorModel: "stored",
              validatorModel: validatorLabel,
              ...(verdict.verdict === "fail"
                ? {rejected: {firstUserMessage: scenario.firstUserMessage}}
                : {}),
              population: populationRowOf(scenario.seed, isPrivate),
            });
          }
          progress.increment(true);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `\nValidation failed for seed ${scenario.seed.id}: ${message.slice(0, 300)}`
          );
          failures.push(scenario.seed.id);
          progress.increment(false);
        }
      },
      pending
    )
  );
  progress.finish();

  const report = buildPassRateReport({
    stage: "opening",
    rows: await readLedger(paths.ledger),
  });
  await writePassRateReport(paths, report);
  console.log(`\n${formatPassRateReport(report)}`);
  console.log(
    `Report → ${paths.reportMd} (and .json); every verdict → ${paths.ledger}`
  );
  if (failures.length > 0) {
    console.log(
      `\n${failures.length} validation call(s) failed. Re-run the same command to retry them.`
    );
  }
  return workSummary(
    "seed",
    scenarios.length,
    scenarios.length - failures.length,
    failures.length,
    scenarios.length - pending.length
  );
}
