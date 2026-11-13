import type {RunStamp} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as R from "remeda";
import type {PassRateReport} from "./passRateReport.js";

//
// Acceptance record.
//
// What `expand-scenarios` says about the corpus it wrote, next to it: the
// build that wrote and validated it, how far each seed had to go to pass, and
// what is left. Every scenario in the output passed the validation under that
// build, a rejection counted only once a second validation confirmed it, so
// the record is the corpus's acceptance: no step was run by hand, and what
// moved (a relabel, a seed written again) is listed.
//

/** How far a seed went before a scenario of it passed. */
export type AcceptanceStep =
  /** Within the attempts of the expansion chain, seed as allocated. */
  | "attempts"
  /** After its signal type or use was moved (`relabelSeed.ts`). */
  | "relabeled"
  /** After its text was written again in its slot (`regenerateSeed`). */
  | "regenerated"
  /** Passed in an earlier run of the same command: step not known here. */
  | "earlier run"
  /** No scenario: in the reject file. */
  | "rejected";

export const ACCEPTANCE_STEPS: readonly AcceptanceStep[] = [
  "attempts",
  "relabeled",
  "regenerated",
  "earlier run",
  "rejected",
];

export interface AcceptanceRecord {
  /** `RunStamp.hash` and the stamp itself: profile, models, prompts, packs. */
  stampHash: string;
  stamp: RunStamp;
  /** The child recipe that wrote the openings, when the profile names one. */
  childSimulator?: {id: string; version: string; hash: string};
  seeds: number;
  scenarios: number;
  steps: Record<AcceptanceStep, number>;
  /** Seed ids per step, rejected and moved seeds only. */
  relabeled: readonly string[];
  regenerated: readonly string[];
  rejected: readonly {seedId: string; reasons: string}[];
  /** Rejections validated twice, and taken back by the second verdict. */
  rechecked: number;
  overturned: number;
  firstAttemptPassRate: number;
  meanAttempts: number;
}

export function buildAcceptanceRecord(args: {
  stamp: RunStamp;
  stampHash: string;
  childSimulator?: {id: string; version: string; hash: string};
  steps: ReadonlyMap<string, AcceptanceStep>;
  scenarios: number;
  rejected: readonly {seedId: string; reasons: string}[];
  report: PassRateReport;
}): AcceptanceRecord {
  const idsAt = (step: AcceptanceStep) =>
    [...args.steps.entries()]
      .filter(([, s]) => s === step)
      .map(([id]) => id)
      .sort();
  return {
    stampHash: args.stampHash,
    stamp: args.stamp,
    ...(args.childSimulator ? {childSimulator: args.childSimulator} : {}),
    seeds: args.steps.size,
    scenarios: args.scenarios,
    steps: Object.fromEntries(
      ACCEPTANCE_STEPS.map(step => [step, idsAt(step).length])
    ) as Record<AcceptanceStep, number>,
    relabeled: idsAt("relabeled"),
    regenerated: idsAt("regenerated"),
    rejected: R.sortBy([...args.rejected], r => r.seedId).map(r => ({
      seedId: r.seedId,
      reasons: r.reasons,
    })),
    rechecked: args.report.rechecked,
    overturned: args.report.overturned,
    firstAttemptPassRate: args.report.overall.firstAttemptPassRate,
    meanAttempts: args.report.overall.meanAttempts,
  };
}

export function formatAcceptanceRecord(record: AcceptanceRecord): string {
  const {stamp} = record;
  const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
  return [
    "# Acceptance record",
    "",
    `Status: ${record.steps.rejected === 0 ? "accepted, every seed has a scenario" : `${record.steps.rejected} seed(s) without a scenario`}.`,
    "",
    "## Build",
    "",
    `- Stamp: ${record.stampHash}`,
    `- Profile: ${stamp.profile.id}@${stamp.profile.version}`,
    `- Prompts: version ${stamp.prompts.version} (${stamp.prompts.hash})`,
    ...(record.childSimulator
      ? [
          `- Child: ${record.childSimulator.id}@${record.childSimulator.version} (${record.childSimulator.hash})`,
        ]
      : []),
    `- Code: @korabench/cli ${stamp.code.version}${stamp.code.commit ? ` (${stamp.code.commit}${stamp.code.dirty ? ", uncommitted changes" : ""})` : ""}`,
    "",
    "## Seeds, by how far they went",
    "",
    "| Step | Seeds |",
    "| --- | ---: |",
    ...ACCEPTANCE_STEPS.map(step => `| ${step} | ${record.steps[step]} |`),
    `| all | ${record.seeds} |`,
    "",
    `Scenarios written: ${record.scenarios}. First-attempt pass ${percent(record.firstAttemptPassRate)}, ${record.meanAttempts.toFixed(2)} attempts per seed. ${record.rechecked} rejection(s) validated twice, ${record.overturned} taken back.`,
    "",
    ...(record.relabeled.length > 0
      ? ["## Relabeled", "", ...record.relabeled.map(id => `- ${id}`), ""]
      : []),
    ...(record.regenerated.length > 0
      ? [
          "## Written again in their slot",
          "",
          ...record.regenerated.map(id => `- ${id}`),
          "",
        ]
      : []),
    ...(record.rejected.length > 0
      ? [
          "## Without a scenario",
          "",
          ...record.rejected.map(r => `- ${r.seedId}: ${r.reasons}`),
          "",
        ]
      : []),
  ].join("\n");
}

/** `data/scenarios.jsonl` → `data/scenarios.acceptance.md` and `.json`. */
export function acceptancePathsFor(outputFilePath: string): {
  md: string;
  json: string;
} {
  const {dir, name} = path.parse(outputFilePath);
  return {
    md: path.join(dir, `${name}.acceptance.md`),
    json: path.join(dir, `${name}.acceptance.json`),
  };
}

export async function writeAcceptanceRecord(
  outputFilePath: string,
  record: AcceptanceRecord
): Promise<{md: string; json: string}> {
  const paths = acceptancePathsFor(outputFilePath);
  await fs.writeFile(paths.md, formatAcceptanceRecord(record));
  await fs.writeFile(paths.json, JSON.stringify(record, null, 2) + "\n");
  return paths;
}
