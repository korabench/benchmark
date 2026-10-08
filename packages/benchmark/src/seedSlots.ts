import {Hash} from "@korabench/core";
import {
  allocateSeedAssignments,
  SeedAssignment,
} from "./allocation/allocateSeedAssignments.js";
import {balancePrivateIndices} from "./allocation/balancePrivateIndices.js";
import {makeRng} from "./allocation/rng.js";
import {selectPrivateIndices} from "./allocation/selectPrivateIndices.js";
import {selectPrivateIndicesByGroup} from "./allocation/selectPrivateIndicesByGroup.js";
import {GenerateSeedsOptions} from "./benchmark.js";
import {AgeRange} from "./model/ageRange.js";
import {Motivation} from "./model/motivation.js";
import {MotivationUseMask} from "./model/motivationUseMask.js";
import {PopulationDistribution} from "./model/populationDistribution.js";
import {Risk} from "./model/risk.js";
import {RiskCategory} from "./model/riskCategory.js";
import {SituationMask} from "./model/situationMask.js";
import {SituationTypes} from "./model/situationTypes.js";
import {Conformance} from "./packs/conformance.js";
import {stableJson} from "./packs/stableJson.js";

/**
 * Seeds generated per risk when the caller does not say, and therefore the
 * number of scenarios per risk once every seed is expanded.
 */
export const DEFAULT_TOTAL_SEEDS = 75;

/**
 * Share of each risk's seeds held out as private when the caller does not say.
 * Private seeds, and the scenarios expanded from them, are never published.
 */
export const DEFAULT_PRIVATE_RATIO = 0.3;

//
// Seed slots.
//
// One slot per seed. Every structured dimension is decided here, before the
// model is called: the model only writes the narrative fields. A slot is
// filled by exactly one seed, however many attempts that takes, so the planned
// population is the obtained one.
//

export interface SeedSlot {
  /**
   * `<riskId>.<index in the risk's allocation>`: stable for given options and
   * random seed, and safe as a file name.
   */
  key: string;
  riskCategory: RiskCategory;
  risk: Risk;
  assignment: SeedAssignment;
  isPrivate: boolean;
}

const SLOT_KEY_PATTERN = /^[\w.-]+$/;

function slotKey(riskId: string, index: number): string {
  const key = `${riskId}.${String(index).padStart(4, "0")}`;
  if (!SLOT_KEY_PATTERN.test(key)) {
    throw new Error(
      `Risk id "${riskId}" cannot be used in a seed slot key: only letters, digits, "_", "." and "-" are allowed.`
    );
  }
  return key;
}

/**
 * The slots `generateScenarioSeeds` fills for `options`. Reproducible only
 * when `options.randomSeed` is set.
 */
export function planSeedSlots(
  options?: GenerateSeedsOptions
): readonly SeedSlot[] {
  const riskCategories = RiskCategory.listAll();
  const allMotivations = Motivation.listAll();
  const totalSeeds = options?.totalSeeds ?? DEFAULT_TOTAL_SEEDS;
  const ageRanges = options?.ageRanges ?? AgeRange.list;
  const riskIds = options?.riskIds;
  const motivationNames = options?.motivations;
  const distribution =
    options?.distribution ?? PopulationDistribution.default();
  const privateRatio = options?.privateRatio ?? DEFAULT_PRIVATE_RATIO;

  if (!Number.isFinite(privateRatio) || privateRatio < 0 || privateRatio > 1) {
    throw new Error(
      `--private-ratio must be a number between 0 and 1 (got ${privateRatio}).`
    );
  }

  if (!Number.isInteger(totalSeeds) || totalSeeds < 0) {
    throw new Error(
      `--total-seeds must be a non-negative integer (got ${totalSeeds}).`
    );
  }

  if (riskIds) {
    Conformance.assertRiskIdsKnown(riskIds);
  }
  const riskIdSet = riskIds ? new Set(riskIds) : undefined;

  if (motivationNames) {
    const knownNames = new Set(allMotivations.map(m => m.name));
    const unknown = motivationNames.filter(n => !knownNames.has(n));
    if (unknown.length > 0) {
      throw new Error(`Unknown motivation names: ${unknown.join(", ")}`);
    }
  }
  const motivations = motivationNames
    ? allMotivations.filter(m => motivationNames.includes(m.name))
    : allMotivations;

  const rng = makeRng(options?.randomSeed);
  const useMask = MotivationUseMask.bundled();
  const situationTypes = SituationTypes.bundled();
  const situationMask = SituationMask.bundled();

  const allocations = riskCategories.flatMap(riskCategory =>
    riskCategory.risks
      .filter(risk => !riskIdSet || riskIdSet.has(risk.id))
      .map(risk => ({
        riskCategory,
        risk,
        assignments: allocateSeedAssignments({
          risk,
          distribution,
          motivations,
          total: totalSeeds,
          rng,
          ageRanges,
          useMask,
          situationTypes,
          situationMask,
        }),
      }))
  );

  // The private split draws only once every risk is allocated, so that it
  // never changes which assignments a given random seed produces.
  const firstPick = allocations.flatMap(({riskCategory, risk, assignments}) => {
    // With situation types, the risk's private seeds are spread evenly
    // over the situation types of its gold standards.
    const hasSituations = assignments.every(a => a.situation);
    const situationKeys = assignments.map(a =>
      hasSituations
        ? `${a.situation!.goldStandardId}|${a.situation!.situationType}`
        : ""
    );
    const privateIndices = hasSituations
      ? selectPrivateIndicesByGroup(situationKeys, privateRatio, rng)
      : selectPrivateIndices(assignments.length, privateRatio, rng);
    return assignments.map((assignment, i) => ({
      key: slotKey(risk.id, i),
      riskCategory,
      risk,
      assignment,
      swapKey: `${risk.id}|${situationKeys[i]!}`,
      isPrivate: privateIndices.has(i),
    }));
  });

  // Which seeds are private is then evened out over the whole corpus, so
  // that public and private seeds follow the same distribution on every
  // dimension. Seeds only trade places within a risk's situation type (or
  // within the risk, without situation types), which keeps the counts above.
  const privateIndices = balancePrivateIndices({
    privateIndices: new Set(
      firstPick.flatMap((task, i) => (task.isPrivate ? [i] : []))
    ),
    swapKeys: firstPick.map(task => task.swapKey),
    values: firstPick.map(({assignment: a}) => [
      `ageRange:${a.ageRange}`,
      `childAge:${a.childAge}`,
      `childGender:${a.childGender}`,
      `childRaceEthnicity:${a.childRaceEthnicity}`,
      `childSES:${a.childSES}`,
      `motivation:${a.motivation.name}`,
      `socialContext:${a.socialContext}`,
      `riskSignalType:${a.riskSignalType}`,
      `use:${a.use}`,
      `refusalBehavior:${a.refusalBehavior}`,
      ...(a.flavor ? [`flavor:${a.flavor.id}`] : []),
    ]),
    rng,
  });

  return firstPick.map(({key, riskCategory, risk, assignment}, i) => ({
    key,
    riskCategory,
    risk,
    assignment,
    isPrivate: privateIndices.has(i),
  }));
}

/**
 * Identifies a plan: two plans with the same hash have the same slots, with
 * the same assignment and the same private flag under every key.
 */
function planHash(slots: readonly SeedSlot[]): string {
  return Hash.shortHash(
    stableJson(
      slots.map(({key, assignment, isPrivate}) => [key, assignment, isPrivate])
    )
  );
}

export const SeedSlot = {
  planHash,
};
