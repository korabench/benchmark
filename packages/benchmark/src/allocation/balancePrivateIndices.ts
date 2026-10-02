import * as R from "remeda";
import {shuffleWith} from "./rng.js";

interface Args {
  /** The seeds held out so far, as indices into `swapKeys` and `values`. */
  privateIndices: ReadonlySet<number>;
  /**
   * `swapKeys[i]` names the set of seeds that seed `i` may trade places with.
   * Each set keeps the number of private seeds it starts with.
   */
  swapKeys: readonly string[];
  /**
   * `values[i]` lists the dimension values of seed `i` to balance, each one
   * spelled so that it is unique across dimensions (`use:homework`).
   */
  values: readonly (readonly string[])[];
  rng: () => number;
}

interface Split {
  isPrivate: readonly boolean[];
  /** Private seeds per dimension value. */
  counts: ReadonlyMap<string, number>;
}

const maxSweeps = 100;

/**
 * Even out the dimension values of the private seeds, so that the private and
 * the public seeds follow the same distribution on every dimension at once.
 *
 * Each value is aimed at the overall private share of its seeds (a value held
 * by 650 seeds, with 598 of 1,950 seeds private, is aimed at 199.3 private
 * seeds). A private and a public seed of the same swap set trade places
 * whenever that brings the counts closer to those targets, by the sum of
 * squared gaps, until no trade helps. Trading inside a swap set leaves its
 * number of private seeds unchanged, so whatever the first pick decided per
 * risk and per situation type still holds.
 *
 * The result is a local optimum: over a full corpus every value ends within
 * about one seed of its target. The candidate trades are visited in an order
 * drawn from `rng`, so a given random seed always yields the same split.
 */
export function balancePrivateIndices(args: Args): ReadonlySet<number> {
  const {privateIndices, swapKeys, values, rng} = args;
  const total = swapKeys.length;
  if (values.length !== total) {
    throw new Error(
      `balancePrivateIndices: got ${values.length} value lists for ${total} seeds.`
    );
  }
  if (privateIndices.size === 0 || privateIndices.size === total) {
    return privateIndices;
  }

  const share = privateIndices.size / total;
  const targets = new Map(
    Object.entries(R.countBy(values.flat(), value => value)).map(
      ([value, count]) => [value, count * share]
    )
  );
  // Only the values a trade changes matter: the ones each seed has and the
  // other lacks.
  const gap = (split: Split, value: string) =>
    (split.counts.get(value) ?? 0) - targets.get(value)!;
  const tradeGain = (split: Split, leaving: number, entering: number) => {
    const lost = R.difference(values[leaving]!, values[entering]!);
    const gained = R.difference(values[entering]!, values[leaving]!);
    return (
      R.sumBy(lost, value => 1 - 2 * gap(split, value)) +
      R.sumBy(gained, value => 1 + 2 * gap(split, value))
    );
  };
  const trade = (split: Split, leaving: number, entering: number): Split => {
    const counts = new Map(split.counts);
    values[leaving]!.forEach(value =>
      counts.set(value, counts.get(value)! - 1)
    );
    values[entering]!.forEach(value =>
      counts.set(value, (counts.get(value) ?? 0) + 1)
    );
    return {
      isPrivate: split.isPrivate.map((p, i) =>
        i === leaving ? false : i === entering ? true : p
      ),
      counts,
    };
  };

  const pairs = shuffleWith(
    Object.values(
      R.groupBy(
        swapKeys.map((key, index) => ({key, index})),
        entry => entry.key
      )
    ).flatMap(entries =>
      entries.flatMap((a, position) =>
        entries.slice(position + 1).map(b => [a.index, b.index] as const)
      )
    ),
    rng
  );

  const sweep = (split: Split): Split =>
    pairs.reduce((current, [a, b]) => {
      if (current.isPrivate[a] === current.isPrivate[b]) return current;
      const [leaving, entering] = current.isPrivate[a] ? [a, b] : [b, a];
      return tradeGain(current, leaving, entering) < -1e-9
        ? trade(current, leaving, entering)
        : current;
    }, split);
  const settle = (split: Split, sweepsLeft: number): Split => {
    const next = sweep(split);
    return next === split || sweepsLeft === 1
      ? next
      : settle(next, sweepsLeft - 1);
  };

  const isPrivate = swapKeys.map((_, i) => privateIndices.has(i));
  const settled = settle(
    {
      isPrivate,
      counts: new Map(
        Object.entries(
          R.countBy(
            values.flatMap((list, i) => (isPrivate[i] ? list : [])),
            value => value
          )
        )
      ),
    },
    maxSweeps
  );

  return new Set(settled.isPrivate.flatMap((p, i) => (p ? [i] : [])));
}
