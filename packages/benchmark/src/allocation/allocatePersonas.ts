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
export type PinnedMaturity = "low" | "medium" | "high";

export interface PinnedDemographics {
  ageRange: AgeRange;
  childAge: number;
  gender: PinnedGender;
  ses: PinnedSES;
  raceEthnicity: PinnedRaceEthnicity;
  cognitiveMaturity: PinnedMaturity;
  emotionalMaturity: PinnedMaturity;
}

export const UNIFORM_MATURITY_DISTRIBUTION: Record<PinnedMaturity, number> = {
  low: 1 / 3,
  medium: 1 / 3,
  high: 1 / 3,
};

const AGES_IN_BRACKET: Record<AgeRange, readonly number[]> = {
  "7to9": [7, 8, 9],
  "10to12": [10, 11, 12],
  "13to17": [13, 14, 15, 16, 17],
};

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

export function expandCounts<K extends string>(counts: Record<K, number>): K[] {
  return (Object.keys(counts) as K[]).flatMap(key =>
    Array.from({length: counts[key]}, () => key)
  );
}

function pickUniform<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
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
 * Cognitive and emotional maturity are pinned as a hardcoded uniform 1/3 split
 * (benchmark-coverage requirement, not a real-world population parameter).
 * `childAge` is an independent uniform draw from the integer ages of the
 * persona's pinned bracket.
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
  const cognitiveCounts = largestRemainderCounts(
    UNIFORM_MATURITY_DISTRIBUTION,
    total
  );
  const emotionalCounts = largestRemainderCounts(
    UNIFORM_MATURITY_DISTRIBUTION,
    total
  );

  const ages = shuffleWith(expandCounts(ageCounts), rng);
  const genders = shuffleWith(expandCounts(genderCounts), rng);
  const sesValues = shuffleWith(expandCounts(sesCounts), rng);
  const races = shuffleWith(expandCounts(raceCounts), rng);
  const cognitives = shuffleWith(expandCounts(cognitiveCounts), rng);
  const emotionals = shuffleWith(expandCounts(emotionalCounts), rng);

  return ages.map((ageRange, i) => {
    const band = ageRange as AgeRange;
    return {
      ageRange: band,
      childAge: pickUniform(AGES_IN_BRACKET[band], rng),
      gender: genders[i] as PinnedGender,
      ses: sesValues[i] as PinnedSES,
      raceEthnicity: races[i] as PinnedRaceEthnicity,
      cognitiveMaturity: cognitives[i] as PinnedMaturity,
      emotionalMaturity: emotionals[i] as PinnedMaturity,
    };
  });
}
