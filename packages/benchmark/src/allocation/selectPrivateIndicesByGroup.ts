import * as R from "remeda";
import {largestRemainderCounts} from "./largestRemainder.js";
import {shuffleWith} from "./rng.js";
import {privateCount} from "./selectPrivateIndices.js";

/**
 * Keep one public seed in every group: a group whose seeds would all be private
 * gives one back to the group furthest below its own share that can take it
 * without emptying its public side either. Nothing moves when no group has
 * that room (a ratio of 1, say).
 */
function keepOnePublic(
  counts: Readonly<Record<string, number>>,
  sizes: Readonly<Record<string, number>>,
  ratio: number
): Readonly<Record<string, number>> {
  const keys = Object.keys(counts);
  const full = keys.find(key => counts[key]! > 0 && counts[key] === sizes[key]);
  const receiver = keys
    .filter(key => counts[key]! < sizes[key]! - 1)
    .reduce<
      string | undefined
    >((best, key) => (best === undefined || sizes[key]! * ratio - counts[key]! > sizes[best]! * ratio - counts[best]! ? key : best), undefined);
  if (full === undefined || receiver === undefined) return counts;
  return keepOnePublic(
    {
      ...counts,
      [full]: counts[full]! - 1,
      [receiver]: counts[receiver]! + 1,
    },
    sizes,
    ratio
  );
}

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
 * within one seed. The one exception keeps every group visible in the public
 * seeds: a group never holds out its last public seed (see `keepOnePublic`).
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
  const sizes = Object.fromEntries(
    [...indicesByGroup].map(([key, indices]) => [key, indices.length])
  );
  const counts = keepOnePublic(
    largestRemainderCounts(
      R.mapValues(sizes, size => size / total),
      count,
      rng
    ),
    sizes,
    ratio
  );

  return new Set(
    [...indicesByGroup].flatMap(([key, indices]) =>
      shuffleWith(indices, rng).slice(0, counts[key]!)
    )
  );
}
