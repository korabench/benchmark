import {AssessmentGrade, Mechanism} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as R from "remeda";
import {Program} from "../cli.js";

//
// Types.
//

interface MechanismEntry {
  grade: AssessmentGrade;
  occurrenceCount?: number;
  reasons?: string;
}

interface AssessmentEntry {
  id: string;
  modelId: string;
  assessment: {grade: AssessmentGrade; reasons?: string};
  behaviorAssessment: Record<string, MechanismEntry>;
}

const GRADES: readonly AssessmentGrade[] = ["failing", "adequate", "exemplary"];

// A mechanism is considered "no signal" when ≥ this fraction of grades fall
// into a single bucket — the metric is effectively constant across runs and
// cannot discriminate between models.
const NO_SIGNAL_THRESHOLD = 0.95;

//
// Loading.
//

async function loadAssessments(filePath: string): Promise<AssessmentEntry[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array at ${filePath}, got ${typeof parsed}`);
  }
  return parsed as AssessmentEntry[];
}

//
// Aggregation.
//

interface MechanismStats {
  total: number;
  counts: Record<AssessmentGrade, number>;
  occurrenceCounts: number[];
}

function emptyStats(): MechanismStats {
  return {
    total: 0,
    counts: {failing: 0, adequate: 0, exemplary: 0},
    occurrenceCounts: [],
  };
}

function collect(
  entries: readonly AssessmentEntry[],
  mechanismIds: readonly string[]
): Record<string, MechanismStats> {
  return Object.fromEntries(
    mechanismIds.map(id => {
      const stats = emptyStats();
      for (const e of entries) {
        const m = e.behaviorAssessment[id];
        if (m === undefined) continue;
        stats.total++;
        stats.counts[m.grade]++;
        stats.occurrenceCounts.push(m.occurrenceCount ?? 0);
      }
      return [id, stats];
    })
  );
}

//
// Rendering.
//

function fmtPct(n: number, total: number): string {
  if (total === 0) return "  0.0%";
  return `${((n / total) * 100).toFixed(1).padStart(5)}%`;
}

function fmtMean(values: readonly number[]): string {
  if (values.length === 0) return "  n/a";
  return (R.mean(values) ?? 0).toFixed(2).padStart(5);
}

function dominantBucket(
  counts: Record<AssessmentGrade, number>,
  total: number
): {grade: AssessmentGrade; fraction: number} | undefined {
  if (total === 0) return undefined;
  const top = R.pipe(
    GRADES,
    R.map(g => ({grade: g, fraction: counts[g] / total})),
    R.sortBy(x => -x.fraction)
  )[0];
  return top;
}

function signalFlag(stats: MechanismStats): string {
  const dom = dominantBucket(stats.counts, stats.total);
  if (dom === undefined) return "—";
  if (dom.fraction >= NO_SIGNAL_THRESHOLD) {
    return `NO SIGNAL (${dom.grade} ${(dom.fraction * 100).toFixed(0)}%)`;
  }
  return "ok";
}

function renderTable(
  label: string,
  mechanismIds: readonly string[],
  stats: Record<string, MechanismStats>,
  mechanismNames: Record<string, string>
): string {
  const headers = [
    "mechanism",
    "n",
    "%fail",
    "%adeq",
    "%exem",
    "occ μ",
    "signal",
  ];
  const rows = mechanismIds.map(id => {
    const s = stats[id] ?? emptyStats();
    return [
      mechanismNames[id] ?? id,
      String(s.total),
      fmtPct(s.counts.failing, s.total),
      fmtPct(s.counts.adequate, s.total),
      fmtPct(s.counts.exemplary, s.total),
      fmtMean(s.occurrenceCounts),
      signalFlag(s),
    ];
  });

  const all: string[][] = [headers, ...rows];
  const widths = headers.map((_, i) =>
    Math.max(...all.map(r => (r[i] ?? "").length))
  );
  const fmt = (r: string[]) =>
    r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");

  return [label, fmt(headers), ...rows.map(fmt)].join("\n");
}

//
// Command.
//

export interface StatsCommandOptions {
  mechanismIds?: readonly string[];
  byModel?: boolean;
}

export async function statsCommand(
  _program: Program,
  inputPath: string,
  options: StatsCommandOptions = {}
): Promise<void> {
  const entries = await loadAssessments(inputPath);

  const allMechanisms = Mechanism.listAll();
  const mechanismIds =
    options.mechanismIds && options.mechanismIds.length > 0
      ? options.mechanismIds
      : allMechanisms.map(m => m.id);

  const invalid = mechanismIds.filter(
    id => !allMechanisms.some(m => m.id === id)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unknown mechanism ids: ${invalid.join(", ")}. ` +
        `Known: ${allMechanisms.map(m => m.id).join(", ")}`
    );
  }

  const mechanismNames = Object.fromEntries(
    allMechanisms.map(m => [m.id, `${m.excelId} ${m.name}`])
  );

  console.log(`Input: ${inputPath} (${entries.length} assessments)`);
  console.log(
    `Signal threshold: ≥${(NO_SIGNAL_THRESHOLD * 100).toFixed(0)}% in one bucket → NO SIGNAL`
  );
  console.log("");

  // Overall.
  const overall = collect(entries, mechanismIds);
  console.log(renderTable("Overall", mechanismIds, overall, mechanismNames));

  if (options.byModel) {
    const byModel = R.groupBy(entries, e => e.modelId);
    const modelIds = Object.keys(byModel).sort();
    for (const modelId of modelIds) {
      console.log("");
      console.log(
        renderTable(
          `Model: ${modelId} (n=${byModel[modelId]!.length})`,
          mechanismIds,
          collect(byModel[modelId]!, mechanismIds),
          mechanismNames
        )
      );
    }
  }
}
