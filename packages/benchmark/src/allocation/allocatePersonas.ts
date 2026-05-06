import {AgeRange} from "../model/ageRange.js";
import {PopulationDistribution} from "../model/populationDistribution.js";
import {largestRemainderCounts} from "./largestRemainder.js";
import {shuffleWith} from "./rng.js";

export type PinnedGender = "girl" | "boy";
export type PinnedSES = "low" | "middle" | "high";
export type PinnedRaceEthnicity =
  | "white"
  | "hispanic"
  | "black"
  | "asian"
  | "other";

export interface PinnedDemographics {
  ageRange: AgeRange;
  gender: PinnedGender;
  ses: PinnedSES;
  raceEthnicity: PinnedRaceEthnicity;
}

function renormalize<K extends string>(
  proportions: Record<K, number>,
  allowedKeys: readonly K[]
): Record<K, number> {
  const kept = allowedKeys.map(k => [k, proportions[k] ?? 0] as const);
  const sum = kept.reduce((acc, [, v]) => acc + v, 0);
  if (sum <= 0) {
    throw new Error(
      `renormalize: allowed keys have zero combined proportion (${allowedKeys.join(", ")}).`
    );
  }
  return Object.fromEntries(kept.map(([k, v]) => [k, v / sum])) as Record<
    K,
    number
  >;
}

function expandCounts<K extends string>(counts: Record<K, number>): K[] {
  return (Object.keys(counts) as K[]).flatMap(key =>
    Array.from({length: counts[key]}, () => key)
  );
}

/**
 * Produce exactly `total` pinned-demographic personas whose marginals match
 * the distribution (within integer rounding, via largest-remainder).
 *
 * Each dimension is independently:
 *   1. Converted to integer counts via largestRemainderCounts(..., total).
 *   2. Expanded into a flat array of length `total`.
 *   3. Shuffled with the provided RNG.
 *
 * The four shuffled arrays are zipped index-wise into PinnedDemographics.
 * Marginals are exact by construction; the joint distribution is the product
 * of marginals in expectation (independent assignment).
 *
 * `allowedAgeRanges` restricts and renormalizes the age dimension (useful when
 * the user passes `--age-ranges` alongside `--distribution`). When omitted,
 * all three bands are used per the distribution.
 */
export function allocatePersonas(
  distribution: PopulationDistribution,
  total: number,
  rng: () => number,
  allowedAgeRanges?: readonly AgeRange[]
): readonly PinnedDemographics[] {
  if (total === 0) return [];

  const ageProportions =
    allowedAgeRanges && allowedAgeRanges.length !== AgeRange.list.length
      ? renormalize(distribution.ageRange, allowedAgeRanges)
      : distribution.ageRange;

  const ageCounts = largestRemainderCounts(ageProportions, total);
  const genderCounts = largestRemainderCounts(distribution.gender, total);
  const sesCounts = largestRemainderCounts(distribution.ses, total);
  const raceCounts = largestRemainderCounts(distribution.raceEthnicity, total);

  const ages = shuffleWith(expandCounts(ageCounts), rng);
  const genders = shuffleWith(expandCounts(genderCounts), rng);
  const sesValues = shuffleWith(expandCounts(sesCounts), rng);
  const races = shuffleWith(expandCounts(raceCounts), rng);

  return ages.map((ageRange, i) => ({
    ageRange: ageRange as AgeRange,
    gender: genders[i] as PinnedGender,
    ses: sesValues[i] as PinnedSES,
    raceEthnicity: races[i] as PinnedRaceEthnicity,
  }));
}
