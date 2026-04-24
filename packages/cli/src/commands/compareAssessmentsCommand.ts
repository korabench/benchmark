import {AssessmentGrade} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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

function indexById(entries: AssessmentEntry[]): Map<string, AssessmentEntry> {
  const map = new Map<string, AssessmentEntry>();
  for (const e of entries) {
    if (map.has(e.id)) {
      throw new Error(`Duplicate id in assessments file: ${e.id}`);
    }
    map.set(e.id, e);
  }
  return map;
}

//
// Comparison.
//

interface FlipMatrix {
  // matrix[origGrade][newGrade] = count
  counts: Record<AssessmentGrade, Record<AssessmentGrade, number>>;
  matched: number;
}

function newFlipMatrix(): FlipMatrix {
  const counts = Object.fromEntries(
    GRADES.map(g => [g, Object.fromEntries(GRADES.map(g2 => [g2, 0]))])
  ) as FlipMatrix["counts"];
  return {counts, matched: 0};
}

function recordFlip(
  matrix: FlipMatrix,
  orig: AssessmentGrade,
  next: AssessmentGrade
): void {
  matrix.counts[orig][next]++;
  matrix.matched++;
}

function agreementRate(m: FlipMatrix): number {
  const diag = GRADES.reduce((s, g) => s + m.counts[g][g], 0);
  return m.matched === 0 ? 0 : diag / m.matched;
}

//
// Rendering.
//

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function renderFlipMatrix(label: string, m: FlipMatrix): string {
  const headers = ["orig ↓ / new →", ...GRADES, "total"];
  const bodyRows = GRADES.map(orig => {
    const row = [orig, ...GRADES.map(g => String(m.counts[orig][g]))];
    const rowTotal = GRADES.reduce((s, g) => s + m.counts[orig][g], 0);
    return [...row, String(rowTotal)];
  });
  const colTotals = [
    "total",
    ...GRADES.map(g =>
      String(GRADES.reduce((s, orig) => s + m.counts[orig][g], 0))
    ),
    String(m.matched),
  ];

  const all: string[][] = [headers, ...bodyRows, colTotals];
  const widths = headers.map((_, i) =>
    Math.max(...all.map(r => (r[i] ?? "").length))
  );
  const fmt = (r: string[]) =>
    r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");

  const diag = GRADES.reduce((s, g) => s + m.counts[g][g], 0);
  const lines = [
    `${label} — agreement ${pct(agreementRate(m))} (${diag}/${m.matched})`,
    fmt(headers),
    ...bodyRows.map(r => fmt(r)),
    fmt(colTotals),
  ];
  return lines.join("\n");
}

//
// CSV.
//

function csvEscape(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(
  filePath: string,
  rows: Record<string, string | number | undefined | null>[]
): Promise<void> {
  const first = rows[0];
  if (first === undefined) return fs.writeFile(filePath, "");
  const columns = Object.keys(first);
  const header = columns.join(",");
  const body = rows
    .map(r => columns.map(c => csvEscape(r[c])).join(","))
    .join("\n");
  return fs.writeFile(filePath, `${header}\n${body}\n`);
}

//
// Command.
//

export interface CompareAssessmentsCommandOptions {
  csvPath?: string;
}

export async function compareAssessmentsCommand(
  _program: Program,
  originalPath: string,
  newPath: string,
  options: CompareAssessmentsCommandOptions = {}
): Promise<void> {
  const [origList, newList] = await Promise.all([
    loadAssessments(originalPath),
    loadAssessments(newPath),
  ]);

  const origById = indexById(origList);
  const newById = indexById(newList);

  const commonIds = [...origById.keys()].filter(id => newById.has(id)).sort();
  const onlyOrig = [...origById.keys()].filter(id => !newById.has(id));
  const onlyNew = [...newById.keys()].filter(id => !origById.has(id));

  console.log(`Original : ${originalPath} (${origList.length} entries)`);
  console.log(`New      : ${newPath} (${newList.length} entries)`);
  console.log(`Matched  : ${commonIds.length}`);
  if (onlyOrig.length > 0) {
    console.log(
      `Only in original: ${onlyOrig.length}${
        onlyOrig.length <= 10 ? ` (${onlyOrig.join(", ")})` : ""
      }`
    );
  }
  if (onlyNew.length > 0) {
    console.log(
      `Only in new     : ${onlyNew.length}${
        onlyNew.length <= 10 ? ` (${onlyNew.join(", ")})` : ""
      }`
    );
  }

  if (commonIds.length === 0) {
    console.log("No common ids — nothing to compare.");
    return;
  }

  // Overall grade flip matrix.
  const overall = newFlipMatrix();

  // Per-mechanism flip matrices (keys = intersection across matched pairs).
  const sharedKeys = (() => {
    const intersect = (a: Set<string>, b: Set<string>) =>
      new Set([...a].filter(x => b.has(x)));
    let acc: Set<string> | undefined;
    for (const id of commonIds) {
      const aKeys = new Set(Object.keys(origById.get(id)!.behaviorAssessment));
      const bKeys = new Set(Object.keys(newById.get(id)!.behaviorAssessment));
      const inter = intersect(aKeys, bKeys);
      acc = acc === undefined ? inter : intersect(acc, inter);
    }
    return [...(acc ?? new Set<string>())].sort();
  })();

  const mechMatrices = new Map<string, FlipMatrix>(
    sharedKeys.map(k => [k, newFlipMatrix()])
  );

  // Per-mechanism occurrenceCount deltas.
  const mechDeltas = new Map<string, number[]>(sharedKeys.map(k => [k, []]));

  // CSV rows.
  const csvRows: Record<string, string | number | undefined | null>[] = [];

  for (const id of commonIds) {
    const o = origById.get(id)!;
    const n = newById.get(id)!;

    recordFlip(overall, o.assessment.grade, n.assessment.grade);

    const row: Record<string, string | number | undefined | null> = {
      id,
      modelId: o.modelId,
      new_modelId: n.modelId === o.modelId ? "" : n.modelId,
      orig_grade: o.assessment.grade,
      new_grade: n.assessment.grade,
      grade_match: o.assessment.grade === n.assessment.grade ? 1 : 0,
    };

    for (const k of sharedKeys) {
      const oEntry = o.behaviorAssessment[k]!;
      const nEntry = n.behaviorAssessment[k]!;
      recordFlip(mechMatrices.get(k)!, oEntry.grade, nEntry.grade);
      const oc = oEntry.occurrenceCount ?? 0;
      const nc = nEntry.occurrenceCount ?? 0;
      mechDeltas.get(k)!.push(nc - oc);

      row[`${k}_orig_grade`] = oEntry.grade;
      row[`${k}_new_grade`] = nEntry.grade;
      row[`${k}_grade_match`] = oEntry.grade === nEntry.grade ? 1 : 0;
      row[`${k}_orig_count`] = oc;
      row[`${k}_new_count`] = nc;
      row[`${k}_count_delta`] = nc - oc;
    }

    csvRows.push(row);
  }

  console.log("");
  console.log(renderFlipMatrix("Overall assessment.grade", overall));

  for (const k of sharedKeys) {
    console.log("");
    console.log(renderFlipMatrix(`Mechanism: ${k}`, mechMatrices.get(k)!));

    const deltas = mechDeltas.get(k)!;
    const absSum = deltas.reduce((s, d) => s + Math.abs(d), 0);
    const posCount = deltas.filter(d => d > 0).length;
    const negCount = deltas.filter(d => d < 0).length;
    const zeroCount = deltas.filter(d => d === 0).length;
    const meanAbs = deltas.length === 0 ? 0 : absSum / deltas.length;
    console.log(
      `  occurrenceCount: mean |Δ|=${meanAbs.toFixed(2)}  ` +
        `+${posCount} / -${negCount} / =${zeroCount}`
    );
  }

  if (options.csvPath) {
    const csvPath = path.resolve(options.csvPath);
    await writeCsv(csvPath, csvRows);
    console.log("");
    console.log(`Per-record CSV → ${csvPath} (${csvRows.length} rows)`);
  }
}
