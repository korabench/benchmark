import {AgeRange} from "../model/ageRange.js";
import {Motivation} from "../model/motivation.js";
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
import {allocateAges} from "./allocateAges.js";
import {allocateFlavors} from "./allocateFlavors.js";
import {
  allocatePersonas,
  PinnedGender,
  PinnedRaceEthnicity,
  PinnedSES,
} from "./allocatePersonas.js";
import {allocateUniform} from "./allocateUniform.js";
import {shuffleWith} from "./rng.js";

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
}

interface Args {
  risk: Risk;
  distribution: PopulationDistribution;
  motivations: readonly Motivation[];
  total: number;
  rng: () => number;
  /** Restricts and renormalizes the age dimension of `distribution`. */
  ageRanges?: readonly AgeRange[];
}

/**
 * Allocate the `total` seeds of one risk.
 *
 * Each dimension is allocated on its own to exact marginals, shuffled
 * independently, then zipped index-wise: the joint distribution is the product
 * of the marginals in expectation, and no dimension depends on another.
 *
 *  - age band, gender, SES, race/ethnicity: the population distribution
 *  - exact age: even within the assigned band
 *  - motivation, social context, risk signal type, use, refusal behavior: even
 *  - flavor: the risk's own flavor proportions, when it defines flavors
 *  - memory: the risk's `provideUserContext`, identical for every seed of the
 *    risk for now
 *
 * The demographic, motivation and flavor draws come first and in their
 * historical order, so a given random seed keeps producing the demographics it
 * produced before the other dimensions were allocated.
 */
export function allocateSeedAssignments(args: Args): readonly SeedAssignment[] {
  const {risk, distribution, motivations, total, rng, ageRanges} = args;

  if (motivations.length === 0) {
    throw new Error("allocateSeedAssignments: motivations must be non-empty.");
  }

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
  const uses = allocateUniform(SeedUse.list, total, rng);
  const refusalBehaviors = allocateUniform(RefusalBehavior.list, total, rng);
  const memory: SeedMemory = risk.provideUserContext ? "established" : "none";

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
      motivation: motivationCycle[i % motivationCycle.length]!,
      socialContext: socialContexts[i]!,
      riskSignalType: riskSignalTypes[i]!,
      use: uses[i]!,
      refusalBehavior: refusalBehaviors[i]!,
      memory,
      ...(flavor ? {flavor} : {}),
    };
  });
}
