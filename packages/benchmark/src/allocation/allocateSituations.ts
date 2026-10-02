import {AgeRange} from "../model/ageRange.js";
import {GoldStandard, SituationTypes} from "../model/situationTypes.js";
import {shuffleWith} from "./rng.js";

/** The gold standard and situation type one seed must be an instance of. */
export interface SeedSituation {
  goldStandardId: string;
  goldStandardName: string;
  situationType: string;
  /** What the situation type means for this gold standard, when listed. */
  situationDescription?: string;
}

/**
 * Split a risk's `total` seeds evenly across its `count` gold standards. When
 * the split is uneven, the first gold standards in list order take the extra.
 */
export function splitAcrossGoldStandards(
  total: number,
  count: number
): readonly number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `splitAcrossGoldStandards: total must be a non-negative integer (got ${total}).`
    );
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `splitAcrossGoldStandards: count must be a positive integer (got ${count}).`
    );
  }
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({length: count}, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Split the `bandTotal` seeds of one gold standard and age band evenly across
 * its `typeCount` situation types: the floor to every type, then one leftover
 * seed each to consecutive types in list order. The run of leftovers starts one
 * position earlier (wrapping round) for each successive age band, so the odd
 * seed does not always land on the same type.
 *
 * `bandIndex` is the band's position in `AgeRange.list`.
 */
export function situationTypeCounts(
  bandTotal: number,
  typeCount: number,
  bandIndex: number
): readonly number[] {
  if (!Number.isInteger(bandTotal) || bandTotal < 0) {
    throw new Error(
      `situationTypeCounts: bandTotal must be a non-negative integer (got ${bandTotal}).`
    );
  }
  if (!Number.isInteger(typeCount) || typeCount < 1) {
    throw new Error(
      `situationTypeCounts: typeCount must be a positive integer (got ${typeCount}).`
    );
  }
  const base = Math.floor(bandTotal / typeCount);
  const leftover = bandTotal % typeCount;
  const start = ((-bandIndex % typeCount) + typeCount) % typeCount;
  return Array.from({length: typeCount}, (_, position) => {
    const offset = (position - start + typeCount) % typeCount;
    return base + (offset < leftover ? 1 : 0);
  });
}

/**
 * Assign a situation type to each seed of one gold standard.
 *
 * `ageRanges[i]` is the age band of seed `i`. Within each band the counts per
 * type are fixed by `situationTypeCounts`; which seed of the band receives
 * which type is drawn at random, so the situation type is independent of every
 * dimension other than the age band.
 */
export function allocateSituations(
  goldStandard: GoldStandard,
  ageRanges: readonly AgeRange[],
  rng: () => number
): readonly SeedSituation[] {
  const types = SituationTypes.allocated(goldStandard);
  if (types.length === 0) {
    throw new Error(
      `allocateSituations: gold standard ${goldStandard.id} has no situation type to allocate.`
    );
  }

  const typeByIndex = new Map<number, string>(
    AgeRange.list.flatMap((band, bandIndex) => {
      const indices = ageRanges.flatMap((ageRange, i) =>
        ageRange === band ? [i] : []
      );
      const counts = situationTypeCounts(
        indices.length,
        types.length,
        bandIndex
      );
      const names = shuffleWith(
        types.flatMap((type, t) =>
          Array.from({length: counts[t]!}, () => type.name)
        ),
        rng
      );
      return indices.map((index, k) => [index, names[k]!] as const);
    })
  );

  const descriptions = new Map(
    types.map(type => [type.name, type.description] as const)
  );

  return ageRanges.map((_, i) => {
    const situationType = typeByIndex.get(i)!;
    const situationDescription = descriptions.get(situationType);
    return {
      goldStandardId: goldStandard.id,
      goldStandardName: goldStandard.name,
      situationType,
      ...(situationDescription ? {situationDescription} : {}),
    };
  });
}
