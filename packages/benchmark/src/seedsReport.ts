import * as R from "remeda";
import {GenerateSeedsOptions} from "./benchmark.js";
import {AgeRange} from "./model/ageRange.js";
import {MotivationUseMask} from "./model/motivationUseMask.js";
import {ScenarioSeed} from "./model/scenarioSeed.js";
import {SituationMask} from "./model/situationMask.js";
import {SituationTypes} from "./model/situationTypes.js";
import {stableJson} from "./packs/stableJson.js";
import {planSeedSlots, SeedSlot} from "./seedSlots.js";

//
// Seeds allocation report.
//
// Every dimension of a seed is allocated by code, so a generated seeds file
// must hold exactly the population that was planned: one seed per slot, each
// with the slot's values, on the public or private side the slot was given.
// This report plans the slots again from the run's options and random seed,
// compares the obtained seeds with them, and lays the counts out per
// dimension and per situation type and age band, so the distribution of a
// corpus can be checked before anything is expanded from it.
//

/** A seed and the side of the split it was written to. */
export interface ReportedSeed {
  seed: ScenarioSeed;
  isPrivate: boolean;
}

/** The assigned values of a seed or a slot, as one comparable record. */
export interface Assigned {
  riskId: string;
  ageRange: string;
  childAge: number;
  childGender: string;
  childRaceEthnicity: string;
  childSES: string;
  motivation: string;
  socialContext: string;
  riskSignalType: string;
  use: string;
  refusalBehavior: string;
  memory: string;
  goldStandardId?: string;
  situationType?: string;
  scenarioFlavorId?: string;
  isPrivate: boolean;
}

/** The dimensions tallied per value, in report order. */
export const REPORT_DIMENSIONS = [
  "ageRange",
  "childGender",
  "childSES",
  "childRaceEthnicity",
  "motivation",
  "use",
  "socialContext",
  "riskSignalType",
  "refusalBehavior",
  "memory",
] as const satisfies readonly (keyof Assigned)[];
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export interface ValueCount {
  dimension: ReportDimension;
  value: string;
  planned: number;
  obtained: number;
  public: number;
  private: number;
  /** Over the risks: the largest |obtained − planned| of this value. */
  maxRiskGap: number;
}

export interface SituationCount {
  riskId: string;
  goldStandardId: string;
  situationType: string;
  /** Per age band: planned and obtained counts. */
  bands: Record<string, {planned: number; obtained: number}>;
  planned: number;
  obtained: number;
}

export interface SeedsReport {
  seeds: number;
  public: number;
  private: number;
  risks: number;
  plannedSlots: number;
  /** Per risk, the assigned records planned and not obtained, and the reverse. */
  differences: readonly {riskId: string; missing: number; extra: number}[];
  values: readonly ValueCount[];
  situations: readonly SituationCount[];
  /** Seeds holding a pair a mask forbids. */
  forbidden: {
    motivationUse: number;
    situationUse: number;
    situationSignal: number;
  };
}

function ofSeed({seed, isPrivate}: ReportedSeed): Assigned {
  return {
    riskId: seed.riskId,
    ageRange: seed.ageRange,
    childAge: seed.childAge,
    childGender: seed.childGender,
    childRaceEthnicity: seed.childRaceEthnicity,
    childSES: seed.childSES ?? "",
    motivation: seed.motivation.name,
    socialContext: seed.socialContext,
    riskSignalType: seed.riskSignalType,
    use: seed.use ?? "",
    refusalBehavior: seed.refusalBehavior ?? "",
    memory: seed.memory ?? "",
    goldStandardId: seed.goldStandardId,
    situationType: seed.situationType,
    scenarioFlavorId: seed.scenarioFlavorId,
    isPrivate,
  };
}

function ofSlot(slot: SeedSlot): Assigned {
  const a = slot.assignment;
  return {
    riskId: slot.risk.id,
    ageRange: a.ageRange,
    childAge: a.childAge,
    childGender: a.childGender,
    childRaceEthnicity: a.childRaceEthnicity,
    childSES: a.childSES,
    motivation: a.motivation.name,
    socialContext: a.socialContext,
    riskSignalType: a.riskSignalType,
    use: a.use,
    refusalBehavior: a.refusalBehavior,
    memory: a.memory,
    goldStandardId: a.situation?.goldStandardId,
    situationType: a.situation?.situationType,
    scenarioFlavorId: a.flavor?.id,
    isPrivate: slot.isPrivate,
  };
}

function countBy<T>(items: readonly T[], key: (item: T) => string) {
  return R.countBy(items, key) as Record<string, number>;
}

/**
 * Plan the slots for `options` (which must carry `randomSeed`) and compare
 * the obtained seeds with them.
 */
export function buildSeedsReport(
  seeds: readonly ReportedSeed[],
  options: GenerateSeedsOptions
): SeedsReport {
  if (options.randomSeed === undefined) {
    throw new Error(
      "buildSeedsReport: options.randomSeed is required to plan the slots again."
    );
  }
  const obtained = seeds.map(ofSeed);
  const planned = planSeedSlots(options).map(ofSlot);
  const riskIds = R.unique([...planned, ...obtained].map(a => a.riskId));

  const differences = riskIds.flatMap(riskId => {
    const mine = (list: readonly Assigned[]) =>
      countBy(
        list.filter(a => a.riskId === riskId),
        stableJson
      );
    const p = mine(planned);
    const o = mine(obtained);
    const missing = R.sum(
      Object.entries(p).map(([k, n]) => Math.max(0, n - (o[k] ?? 0)))
    );
    const extra = R.sum(
      Object.entries(o).map(([k, n]) => Math.max(0, n - (p[k] ?? 0)))
    );
    return missing || extra ? [{riskId, missing, extra}] : [];
  });

  const values = REPORT_DIMENSIONS.flatMap(dimension => {
    const of = (a: Assigned) => String(a[dimension]);
    const allValues = R.unique([...planned, ...obtained].map(of)).sort();
    const plannedCounts = countBy(planned, of);
    const obtainedCounts = countBy(obtained, of);
    const publicCounts = countBy(
      obtained.filter(a => !a.isPrivate),
      of
    );
    return allValues.map(value => ({
      dimension,
      value,
      planned: plannedCounts[value] ?? 0,
      obtained: obtainedCounts[value] ?? 0,
      public: publicCounts[value] ?? 0,
      private: (obtainedCounts[value] ?? 0) - (publicCounts[value] ?? 0),
      maxRiskGap: Math.max(
        0,
        ...riskIds.map(riskId => {
          const n = (list: readonly Assigned[]) =>
            list.filter(a => a.riskId === riskId && of(a) === value).length;
          return Math.abs(n(obtained) - n(planned));
        })
      ),
    }));
  });

  const situationTypes = SituationTypes.bundled();
  const situations = riskIds.flatMap(riskId =>
    (SituationTypes.forRisk(situationTypes, riskId) ?? []).flatMap(gs =>
      SituationTypes.allocated(gs).map(type => {
        const of = (list: readonly Assigned[]) =>
          list.filter(
            a =>
              a.riskId === riskId &&
              a.goldStandardId === gs.id &&
              a.situationType === type.name
          );
        const bands = Object.fromEntries(
          AgeRange.list.map(band => [
            band,
            {
              planned: of(planned).filter(a => a.ageRange === band).length,
              obtained: of(obtained).filter(a => a.ageRange === band).length,
            },
          ])
        );
        return {
          riskId,
          goldStandardId: gs.id,
          situationType: type.name,
          bands,
          planned: of(planned).length,
          obtained: of(obtained).length,
        };
      })
    )
  );

  const useMask = MotivationUseMask.bundled();
  const situationMask = SituationMask.bundled();
  const forbidden = {
    motivationUse: seeds.filter(
      ({seed}) =>
        seed.use !== undefined &&
        !MotivationUseMask.allowed(useMask, seed.motivation.name, seed.use)
    ).length,
    situationUse: seeds.filter(
      ({seed}) =>
        seed.use !== undefined &&
        seed.situationType !== undefined &&
        !SituationMask.allowsUse(
          situationMask,
          seed.riskId,
          seed.situationType,
          seed.use
        )
    ).length,
    situationSignal: seeds.filter(
      ({seed}) =>
        seed.situationType !== undefined &&
        !SituationMask.allowsRiskSignalType(
          situationMask,
          seed.riskId,
          seed.situationType,
          seed.riskSignalType
        )
    ).length,
  };

  return {
    seeds: seeds.length,
    public: seeds.filter(s => !s.isPrivate).length,
    private: seeds.filter(s => s.isPrivate).length,
    risks: riskIds.length,
    plannedSlots: planned.length,
    differences,
    values,
    situations,
    forbidden,
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "–" : `${((n / total) * 100).toFixed(1)}%`;
}

/** The report as Markdown. */
export function formatSeedsReport(report: SeedsReport, title: string): string {
  // A seed that differs from its plan is one obtained record no slot planned.
  const gaps = R.sum(report.differences.map(d => d.extra));
  const lines = [
    `# Seeds allocation: ${title}`,
    "",
    `${report.seeds} seeds (${report.public} public, ${report.private} private) over ${report.risks} risks; ${report.plannedSlots} slots planned.`,
    gaps === 0
      ? "**Every seed carries the values of its planned slot**, on the planned side of the split: the obtained population is the planned one."
      : `**${gaps} seed(s) differ from the plan**: ` +
        report.differences
          .map(
            d =>
              `${d.riskId} (${d.missing} planned not obtained, ${d.extra} obtained not planned)`
          )
          .join("; ") +
        "." +
        (report.values.every(v => v.maxRiskGap === 0)
          ? " The counts per value match the plan in every risk: the seeds pair the values differently, which a plan made under other mask rules than the file's does (run the report at the commit that generated the file)."
          : ""),
    "",
    "## Per dimension",
    "",
    "`max risk gap` is the largest difference between obtained and planned counts of the value in one risk (0 when every risk matches its plan).",
    "",
  ];
  for (const dimension of REPORT_DIMENSIONS) {
    const rows = report.values.filter(v => v.dimension === dimension);
    if (rows.every(r => r.value === "")) continue;
    lines.push(
      `### ${dimension}`,
      "",
      "| value | planned | obtained | share | public | private | max risk gap |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map(
        r =>
          `| ${r.value || "(none)"} | ${r.planned} | ${r.obtained} | ${pct(r.obtained, report.seeds)} | ${r.public} | ${r.private} | ${r.maxRiskGap} |`
      ),
      ""
    );
  }
  lines.push(
    "## Situation types",
    "",
    "Per gold standard and age band: planned / obtained. The plan spreads each gold standard's seeds evenly over its situation types within every age band, drift types excluded.",
    ""
  );
  const byGoldStandard = R.groupBy(
    report.situations,
    s => `${s.riskId} | ${s.goldStandardId}`
  );
  for (const [key, rows] of Object.entries(byGoldStandard)) {
    const total = R.sum(rows.map(r => r.obtained));
    const mismatches = rows.filter(
      r =>
        r.planned !== r.obtained ||
        AgeRange.list.some(b => r.bands[b]!.planned !== r.bands[b]!.obtained)
    ).length;
    lines.push(
      `### ${key} (${total} seeds${mismatches ? `, ${mismatches} type(s) off plan` : ""})`,
      "",
      `| situation type | ${AgeRange.list.join(" | ")} | total |`,
      `| --- | ${AgeRange.list.map(() => "---:").join(" | ")} | ---: |`,
      ...rows.map(
        r =>
          `| ${r.situationType} | ${AgeRange.list
            .map(b => `${r.bands[b]!.planned} / ${r.bands[b]!.obtained}`)
            .join(" | ")} | ${r.planned} / ${r.obtained} |`
      ),
      ""
    );
  }
  lines.push(
    "## Masks",
    "",
    `Seeds holding a forbidden pair: motivation × use ${report.forbidden.motivationUse}, situation type × use ${report.forbidden.situationUse}, situation type × risk signal type ${report.forbidden.situationSignal}.`,
    ""
  );
  return lines.join("\n");
}

export const SeedsReport = {
  build: buildSeedsReport,
  format: formatSeedsReport,
};
