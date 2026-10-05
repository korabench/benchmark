import {AgeRange} from "../model/ageRange.js";
import {Motivation} from "../model/motivation.js";
import {MotivationUseMask} from "../model/motivationUseMask.js";
import {PopulationDistribution} from "../model/populationDistribution.js";
import {Risk} from "../model/risk.js";
import {ScenarioFlavor} from "../model/scenarioFlavor.js";
import {
  RefusalBehavior,
  RiskSignalType,
  SeedMemory,
  SeedUse,
  SocialContext,
} from "../model/scenarioSeed.js";
import {SituationMask} from "../model/situationMask.js";
import {GoldStandard, SituationTypes} from "../model/situationTypes.js";
import {allocateAges} from "./allocateAges.js";
import {allocateFlavors} from "./allocateFlavors.js";
import {
  allocatePersonas,
  PinnedGender,
  PinnedRaceEthnicity,
  PinnedSES,
} from "./allocatePersonas.js";
import {
  allocateSituations,
  SeedSituation,
  splitAcrossGoldStandards,
} from "./allocateSituations.js";
import {allocateUniform} from "./allocateUniform.js";
import {pairUsesWithMotivations} from "./pairUsesWithMotivations.js";
import {shuffleWith} from "./rng.js";
import {swapAwayForbidden} from "./swapAwayForbidden.js";

/**
 * Every structured dimension of one seed, decided by code before the model is
 * called. The model receives these as fixed inputs and only writes the
 * narrative fields; the same values are then stamped onto the stored seed.
 */
export interface SeedAssignment {
  ageRange: AgeRange;
  childAge: number;
  childGender: PinnedGender;
  childRaceEthnicity: PinnedRaceEthnicity;
  childSES: PinnedSES;
  motivation: Motivation;
  socialContext: SocialContext;
  riskSignalType: RiskSignalType;
  use: SeedUse;
  refusalBehavior: RefusalBehavior;
  memory: SeedMemory;
  /** Present only when the risk defines scenario flavors. */
  flavor?: ScenarioFlavor;
  /** Present only when situation types are listed for the risk. */
  situation?: SeedSituation;
}

interface Args {
  risk: Risk;
  distribution: PopulationDistribution;
  motivations: readonly Motivation[];
  total: number;
  rng: () => number;
  /** Restricts and renormalizes the age dimension of `distribution`. */
  ageRanges?: readonly AgeRange[];
  /**
   * Motivation × use mask. When given, uses are reordered so that no seed gets
   * a use forbidden for its motivation; the counts per use and per motivation
   * are the same either way.
   */
  useMask?: MotivationUseMask;
  /**
   * Situation types per risk. When given and the risk is listed, its seeds are
   * split evenly across its gold standards, then across their situation types.
   */
  situationTypes?: SituationTypes;
  /**
   * Situation type × use and × risk signal type mask. When given, the uses and
   * the signal types are reordered among the seeds so that no seed gets a
   * value forbidden for its situation type; situation types stay where they
   * are, and the counts per use and per signal type are the same either way.
   */
  situationMask?: SituationMask;
}

/**
 * Allocate the seeds of one risk, or of one gold standard of an umbrella risk.
 *
 * Each dimension is allocated on its own to exact marginals, shuffled
 * independently, then zipped index-wise: the joint distribution is the product
 * of the marginals in expectation, and no dimension depends on another. The one
 * exception is `use`, whose values are then reordered to avoid the pairings
 * `useMask` forbids, when it is given: its marginal is untouched, and it
 * stays independent of every dimension other than motivation. The situation
 * type is the other: its counts are fixed per age band, so it depends on the
 * age band and on nothing else. Last, `situationMask` trades uses and risk
 * signal types between seeds to avoid the few values it forbids for a
 * situation type: the situation types do not move, and neither marginal
 * changes.
 *
 *  - age band, gender, SES, race/ethnicity: the population distribution
 *  - exact age: even within the assigned band
 *  - motivation, social context, risk signal type, use, refusal behavior: even
 *  - flavor: the risk's own flavor proportions, when it defines flavors
 *  - memory: the risk's `provideUserContext`, identical for every seed of the
 *    risk for now
 *  - situation type: even across the gold standard's types within each age
 *    band, when `situationTypes` lists the risk
 *
 * A risk that is an umbrella over several gold standards is split evenly across
 * them first, and each share is then allocated on its own, exactly as a risk
 * with a single gold standard would be.
 *
 * The demographic, motivation and flavor draws come first and in their
 * historical order, so a given random seed keeps producing the demographics it
 * produced before the other dimensions were allocated. The use pairing and the
 * situation types draw last for the same reason, and the situation mask draws
 * nothing at all.
 */
function allocateShare(
  args: Args,
  total: number,
  goldStandard: GoldStandard | undefined
): readonly SeedAssignment[] {
  const {risk, distribution, motivations, rng, ageRanges} = args;
  const {useMask, situationMask} = args;

  const personas = allocatePersonas(distribution, total, rng, ageRanges);
  const motivationCycle = shuffleWith(motivations, rng);
  const flavorIds = risk.scenarioFlavors
    ? allocateFlavors(risk.scenarioFlavors, total, rng)
    : undefined;

  const ages = allocateAges(
    personas.map(p => p.ageRange),
    rng
  );
  const socialContexts = allocateUniform(SocialContext.list, total, rng);
  const riskSignalTypes = allocateUniform(RiskSignalType.list, total, rng);
  const unpairedUses = allocateUniform(SeedUse.list, total, rng);
  const refusalBehaviors = allocateUniform(RefusalBehavior.list, total, rng);
  const memory: SeedMemory = risk.provideUserContext ? "established" : "none";

  const seedMotivations = personas.map(
    (_, i) => motivationCycle[i % motivationCycle.length]!
  );
  const uses = useMask
    ? pairUsesWithMotivations(
        seedMotivations.map(m => m.name),
        unpairedUses,
        useMask,
        rng
      )
    : unpairedUses;
  const situations = goldStandard
    ? allocateSituations(
        goldStandard,
        personas.map(p => p.ageRange),
        rng
      )
    : undefined;

  // Trades that avoid a forbidden situation pair never create a forbidden
  // motivation × use pair.
  const maskedUses =
    situations && situationMask
      ? swapAwayForbidden(
          uses,
          (i, use) =>
            (!useMask ||
              MotivationUseMask.allowed(
                useMask,
                seedMotivations[i]!.name,
                use
              )) &&
            SituationMask.allowsUse(
              situationMask,
              risk.id,
              situations[i]!.situationType,
              use
            )
        )
      : uses;
  const maskedRiskSignalTypes =
    situations && situationMask
      ? swapAwayForbidden(riskSignalTypes, (i, riskSignalType) =>
          SituationMask.allowsRiskSignalType(
            situationMask,
            risk.id,
            situations[i]!.situationType,
            riskSignalType
          )
        )
      : riskSignalTypes;

  return personas.map((persona, i) => {
    const flavor = flavorIds
      ? risk.scenarioFlavors?.find(f => f.id === flavorIds[i])
      : undefined;
    return {
      ageRange: persona.ageRange,
      childAge: ages[i]!,
      childGender: persona.gender,
      childRaceEthnicity: persona.raceEthnicity,
      childSES: persona.ses,
      motivation: seedMotivations[i]!,
      socialContext: socialContexts[i]!,
      riskSignalType: maskedRiskSignalTypes[i]!,
      use: maskedUses[i]!,
      refusalBehavior: refusalBehaviors[i]!,
      memory,
      ...(flavor ? {flavor} : {}),
      ...(situations ? {situation: situations[i]!} : {}),
    };
  });
}

export function allocateSeedAssignments(args: Args): readonly SeedAssignment[] {
  const {risk, motivations, total, situationTypes} = args;

  if (motivations.length === 0) {
    throw new Error("allocateSeedAssignments: motivations must be non-empty.");
  }

  const goldStandards = situationTypes
    ? SituationTypes.forRisk(situationTypes, risk.id)
    : undefined;
  if (!goldStandards) return allocateShare(args, total, undefined);

  const shares = splitAcrossGoldStandards(total, goldStandards.length);
  return goldStandards.flatMap((goldStandard, i) =>
    allocateShare(args, shares[i]!, goldStandard)
  );
}
