import * as v from "valibot";
import bundledData from "../../data/situationTypes.json" with {type: "json"};
import {AgeRange} from "./ageRange.js";

//
// Runtime model.
//
// The situation types of each risk's gold standards: the distinct ways the risk
// shows up in a conversation ("Direct request", "Reframed request", ...), as
// listed in Section 1 of each gold standard. A risk has one gold standard,
// except where it is an umbrella over several (self-harm: 1.2a, 1.2b, 1.2c).
//
// Seed allocation spreads each risk's seeds evenly over its gold standards,
// then over their situation types (see `allocation/allocateSituations.ts`).
// Like the motivation × use matrix, this is seed-generation input, not part of
// the pack: editing it does not change the pack stamp on results.
//

const VSituationType = v.strictObject({
  name: v.string(),
  /**
   * What the situation type means for this gold standard, from its "Scenarios
   * in scope" list. The same name ("Direct request") is defined differently
   * from one gold standard to the next, so prompts quote this, not the name
   * alone.
   */
  description: v.optional(v.string()),
  /**
   * Multi-turn drift types stay listed but receive no seeds: whether a
   * conversation drifts is left to the generator, not controlled here.
   */
  drift: v.optional(v.boolean()),
  /**
   * The age bands the type applies to, when its definition is about a child of
   * a given age ("A 7–9 year old asks..."). Seeds of the other bands never
   * receive it. Absent: every band.
   */
  ageRanges: v.optional(v.pipe(v.array(AgeRange.io), v.minLength(1))),
});

const VGoldStandard = v.strictObject({
  /** The gold standard's number in the taxonomy, e.g. "1.2b". */
  id: v.string(),
  name: v.string(),
  situationTypes: v.array(VSituationType),
});

const VSituationTypes = v.array(
  v.strictObject({
    riskId: v.string(),
    goldStandards: v.pipe(v.array(VGoldStandard), v.minLength(1)),
  })
);

//
// API.
//

let cached: SituationTypes | undefined;

function bundled(): SituationTypes {
  return (cached ??= v.parse(VSituationTypes, bundledData));
}

/** The gold standards of `riskId`, or undefined when none are listed for it. */
function forRisk(
  situationTypes: SituationTypes,
  riskId: string
): readonly GoldStandard[] | undefined {
  return situationTypes.find(entry => entry.riskId === riskId)?.goldStandards;
}

/**
 * One line naming a seed's situation type and gold standard, for prompts,
 * followed by the type's description. The gold standard's name and the
 * description are looked up in the bundled list and left out when not found
 * there.
 */
function describe(seed: {
  goldStandardId?: string;
  situationType?: string;
}): string | undefined {
  if (!seed.situationType) return undefined;
  const goldStandard = bundled()
    .flatMap(entry => entry.goldStandards)
    .find(gs => gs.id === seed.goldStandardId);
  const within = goldStandard
    ? ` (within ${goldStandard.id}, ${goldStandard.name})`
    : "";
  const description = goldStandard?.situationTypes.find(
    type => type.name === seed.situationType
  )?.description;
  return `${seed.situationType}${within}${description ? `: ${description}` : ""}`;
}

/**
 * The situation types of a gold standard that receive seeds, in list order.
 * With `ageRange`, only those a child of that band can be given.
 */
function allocated(
  goldStandard: GoldStandard,
  ageRange?: AgeRange
): readonly SituationType[] {
  return goldStandard.situationTypes.filter(
    type =>
      !type.drift &&
      (ageRange === undefined ||
        type.ageRanges === undefined ||
        type.ageRanges.includes(ageRange))
  );
}

//
// Exports.
//

export interface SituationType extends v.InferOutput<typeof VSituationType> {}
export interface GoldStandard extends v.InferOutput<typeof VGoldStandard> {}
export type SituationTypes = v.InferOutput<typeof VSituationTypes>;

export const SituationTypes = {
  io: VSituationTypes,
  bundled,
  forRisk,
  describe,
  allocated,
};
