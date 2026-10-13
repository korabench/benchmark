import * as v from "valibot";
import gs1_1 from "../../data/goldStandardRubrics/1.1.json" with {type: "json"};
import gs1_2a from "../../data/goldStandardRubrics/1.2a.json" with {type: "json"};
import gs1_2b from "../../data/goldStandardRubrics/1.2b.json" with {type: "json"};
import gs1_2c from "../../data/goldStandardRubrics/1.2c.json" with {type: "json"};
import gs1_3 from "../../data/goldStandardRubrics/1.3.json" with {type: "json"};
import gs2_1 from "../../data/goldStandardRubrics/2.1.json" with {type: "json"};
import gs2_2 from "../../data/goldStandardRubrics/2.2.json" with {type: "json"};
import gs2_3 from "../../data/goldStandardRubrics/2.3.json" with {type: "json"};
import gs2_4 from "../../data/goldStandardRubrics/2.4.json" with {type: "json"};
import gs3_1 from "../../data/goldStandardRubrics/3.1.json" with {type: "json"};
import gs3_2 from "../../data/goldStandardRubrics/3.2.json" with {type: "json"};
import gs3_3 from "../../data/goldStandardRubrics/3.3.json" with {type: "json"};
import gs3_4 from "../../data/goldStandardRubrics/3.4.json" with {type: "json"};
import gs4_1 from "../../data/goldStandardRubrics/4.1.json" with {type: "json"};
import gs4_2 from "../../data/goldStandardRubrics/4.2.json" with {type: "json"};
import gs5_1 from "../../data/goldStandardRubrics/5.1.json" with {type: "json"};
import gs5_2 from "../../data/goldStandardRubrics/5.2.json" with {type: "json"};
import gs5_3 from "../../data/goldStandardRubrics/5.3.json" with {type: "json"};
import gs6_1 from "../../data/goldStandardRubrics/6.1.json" with {type: "json"};
import gs6_2 from "../../data/goldStandardRubrics/6.2.json" with {type: "json"};
import gs6_3 from "../../data/goldStandardRubrics/6.3.json" with {type: "json"};
import gs7_1 from "../../data/goldStandardRubrics/7.1.json" with {type: "json"};
import gs7_2 from "../../data/goldStandardRubrics/7.2.json" with {type: "json"};
import gs7_3 from "../../data/goldStandardRubrics/7.3.json" with {type: "json"};
import gs8_1 from "../../data/goldStandardRubrics/8.1.json" with {type: "json"};
import gs8_2 from "../../data/goldStandardRubrics/8.2.json" with {type: "json"};
import gs8_3 from "../../data/goldStandardRubrics/8.3.json" with {type: "json"};
import gs8_4 from "../../data/goldStandardRubrics/8.4.json" with {type: "json"};
import {AssessmentGrade} from "./assessmentGrade.js";
import {SituationTypes} from "./situationTypes.js";

//
// Runtime model.
//
// The judge's rubric for one gold standard, transcribed from the post-review
// GS documents ("GS post expert review", see `data/README.md`): the short harm
// statement (Section 1), the expected mitigation (Section 3), the behavioural
// anchors C1–C9 (Section 5), the veto rules (Section 6) and the calibration
// corpus with its gold labels (Parts B and C). The boundaries (Section 4) are
// not repeated here: they live with the situation types.
//
// The grade scale, the decision tree and the cross-risk rules are the same in
// every gold standard; the safety judge's prompt carries them once.
//

export const CRITERION_IDS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C9",
] as const;

const VCriterion = v.strictObject({
  id: v.picklist(CRITERION_IDS),
  name: v.string(),
  /** The question the criterion asks of this risk, verbatim. */
  anchor: v.string(),
  /** The weight as the gold standard words it ("CRITICAL . Automatic FAILING"). */
  weight: v.string(),
});

const VVeto = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^V\d$/)),
  name: v.string(),
  signal: v.string(),
  /**
   * A proposed veto is not applied by the judge until an expert confirms it
   * (benchmark ruling §0.19).
   */
  status: v.picklist(["confirmed", "proposed"]),
});

const VCalibrationCase = v.strictObject({
  /** The case id of the gold standard, e.g. "GS-1_1-001". */
  id: v.string(),
  title: v.string(),
  ageGroup: v.string(),
  childProfile: v.optional(v.string()),
  turns: v.pipe(
    v.array(v.strictObject({child: v.string(), assistant: v.string()})),
    v.minLength(1)
  ),
  gold: v.strictObject({
    /** The scorable level of the gold label. */
    grade: AssessmentGrade.io,
    /** Two levels were defensible; the team registered a flag (§0.21). */
    borderline: v.optional(v.literal(true)),
    /** The decision-tree question the experts stopped at, verbatim. */
    terminalQuestion: v.optional(v.string()),
    criteriaCited: v.optional(v.string()),
    /** Unnamed when one expert annotated the case. */
    expertNotes: v.array(
      v.strictObject({by: v.optional(v.string()), text: v.string()})
    ),
    /** How the gold label was settled, including against earlier judges. */
    reconciliation: v.optional(v.string()),
  }),
});

const VGoldStandardRubric = v.strictObject({
  /** The gold standard's number in the taxonomy, e.g. "1.2b". */
  id: v.string(),
  riskId: v.string(),
  name: v.string(),
  source: v.strictObject({
    title: v.string(),
    driveFileId: v.string(),
    modifiedTime: v.string(),
  }),
  harmStatement: v.string(),
  expectedMitigation: v.pipe(v.array(v.string()), v.minLength(1)),
  criteria: v.pipe(v.array(VCriterion), v.length(CRITERION_IDS.length)),
  vetoes: v.pipe(v.array(VVeto), v.minLength(1)),
  cases: v.pipe(v.array(VCalibrationCase), v.minLength(1)),
});

//
// API.
//

const BUNDLED_DATA: readonly unknown[] = [
  gs1_1,
  gs1_2a,
  gs1_2b,
  gs1_2c,
  gs1_3,
  gs2_1,
  gs2_2,
  gs2_3,
  gs2_4,
  gs3_1,
  gs3_2,
  gs3_3,
  gs3_4,
  gs4_1,
  gs4_2,
  gs5_1,
  gs5_2,
  gs5_3,
  gs6_1,
  gs6_2,
  gs6_3,
  gs7_1,
  gs7_2,
  gs7_3,
  gs8_1,
  gs8_2,
  gs8_3,
  gs8_4,
];

let cached: readonly GoldStandardRubric[] | undefined;

function bundled(): readonly GoldStandardRubric[] {
  return (cached ??= BUNDLED_DATA.map(data =>
    v.parse(VGoldStandardRubric, data)
  ));
}

function find(id: string): GoldStandardRubric {
  const rubric = bundled().find(r => r.id === id);
  if (!rubric) {
    throw new Error(`No gold standard rubric for "${id}".`);
  }
  return rubric;
}

/**
 * The rubric a seed is judged against: its own gold standard, or the risk's
 * only one when the seed names none. A risk that is an umbrella over several
 * gold standards (self-harm: 1.2a, 1.2b, 1.2c) needs the seed to name one.
 */
function forSeed(seed: {
  riskId: string;
  goldStandardId?: string;
}): GoldStandardRubric {
  if (seed.goldStandardId) {
    const rubric = find(seed.goldStandardId);
    if (rubric.riskId !== seed.riskId) {
      throw new Error(
        `Gold standard ${rubric.id} belongs to risk "${rubric.riskId}", not "${seed.riskId}".`
      );
    }
    return rubric;
  }

  const goldStandards =
    SituationTypes.forRisk(SituationTypes.bundled(), seed.riskId) ?? [];
  const [only, ...rest] = goldStandards;
  if (!only || rest.length > 0) {
    throw new Error(
      `Risk "${seed.riskId}" has ${goldStandards.length} gold standards; the seed must name one with goldStandardId.`
    );
  }
  return find(only.id);
}

/** The vetoes the judge applies: proposed ones wait for confirmation (§0.19). */
function confirmedVetoes(rubric: GoldStandardRubric) {
  return rubric.vetoes.filter(veto => veto.status === "confirmed");
}

//
// Exports.
//

export interface GoldStandardRubric extends v.InferOutput<
  typeof VGoldStandardRubric
> {}
export type CalibrationCase = GoldStandardRubric["cases"][number];
export type CriterionId = (typeof CRITERION_IDS)[number];

export const GoldStandardRubric = {
  io: VGoldStandardRubric,
  bundled,
  find,
  forSeed,
  confirmedVetoes,
};
