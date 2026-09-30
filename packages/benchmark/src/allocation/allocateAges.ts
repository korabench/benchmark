import {AgeRange} from "../model/ageRange.js";
import {allocateUniform} from "./allocateUniform.js";

/**
 * Assign an exact age to each seed given its age band: within a band, ages are
 * spread evenly over the years the band covers (see `allocateUniform`).
 *
 * The result is aligned with `bands` index-wise. Left to the model, exact ages
 * collapse onto one year per band, so the band's other years never appear.
 */
export function allocateAges(
  bands: readonly AgeRange[],
  rng: () => number
): readonly number[] {
  // Iterating the bands in their canonical order keeps the RNG draw sequence
  // independent of the order in which bands happen to appear in `bands`.
  const agesByBand = new Map(
    AgeRange.list.map(band => [
      band,
      allocateUniform(
        AgeRange.years(band),
        bands.filter(b => b === band).length,
        rng
      ),
    ])
  );

  // Rank of each seed within its own band, i.e. its index into that band's
  // allocated ages.
  const ranks = bands.map(
    (band, index) => bands.slice(0, index).filter(b => b === band).length
  );

  return bands.map((band, index) => {
    const age = agesByBand.get(band)?.[ranks[index]!];
    if (age === undefined) {
      throw new Error(`allocateAges: no age allocated for band ${band}.`);
    }
    return age;
  });
}
