import {largestRemainderCounts} from "./largestRemainder.js";
import {shuffleWith} from "./rng.js";
import {privateCount} from "./selectPrivateIndices.js";

/**
 * Pick which seeds are held out as private, spread evenly over groups.
 *
 * `groupKeys[i]` is the group of seed `i`. The number of private seeds is the
 * same as `selectPrivateIndices` would pick: `ratio` of all the seeds, rounded
 * to the nearest integer. That number is then shared between the
 * groups in proportion to their size (largest remainder, the leftover seeds
 * drawn at random in proportion to the remainders), and each group's private
 * seeds are drawn uniformly within it.
 *
 * So the overall count is fixed, and every group holds out its own `ratio`, to
 * within one seed.
 */
export function selectPrivateIndicesByGroup(
  groupKeys: readonly string[],
  ratio: number,
  rng: () => number
): ReadonlySet<number> {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(
      `selectPrivateIndicesByGroup: ratio must be between 0 and 1 (got ${ratio}).`
    );
  }
  const total = groupKeys.length;
  if (total === 0 || ratio === 0) return new Set();

  const indicesByGroup = groupKeys.reduce((groups, key, index) => {
    groups.set(key, [...(groups.get(key) ?? []), index]);
    return groups;
  }, new Map<string, number[]>());

  const count = privateCount(total, ratio);
  const counts = largestRemainderCounts(
    Object.fromEntries(
      [...indicesByGroup].map(([key, indices]) => [key, indices.length / total])
    ),
    count,
    rng
  );

  return new Set(
    [...indicesByGroup].flatMap(([key, indices]) =>
      shuffleWith(indices, rng).slice(0, counts[key]!)
    )
  );
}
