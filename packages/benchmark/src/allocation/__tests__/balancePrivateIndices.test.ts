import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {balancePrivateIndices} from "../balancePrivateIndices.js";
import {makeRng, shuffleWith} from "../rng.js";
import {selectPrivateIndicesByGroup} from "../selectPrivateIndicesByGroup.js";

const colors = ["red", "green", "blue"];
const sizes = ["small", "large"];
const shapes = ["round", "square", "flat", "long", "thin"];

/** 20 swap sets of 30 seeds, three dimensions shuffled independently. */
function makeCorpus(seed: number) {
  const rng = makeRng(seed);
  const total = 600;
  const spread = (list: readonly string[], name: string) =>
    shuffleWith(
      R.times(total, i => `${name}:${list[i % list.length]!}`),
      rng
    );
  const dimensions = [
    spread(colors, "color"),
    spread(sizes, "size"),
    spread(shapes, "shape"),
  ];
  const swapKeys = R.times(total, i => `set-${i % 20}`);
  const values = R.times(total, i => dimensions.map(d => d[i]!));
  const privateIndices = selectPrivateIndicesByGroup(swapKeys, 0.3, rng);
  return {swapKeys, values, privateIndices, rng};
}

function largestGap(
  values: readonly (readonly string[])[],
  privateIndices: ReadonlySet<number>
): number {
  const share = privateIndices.size / values.length;
  const all = R.countBy(values.flat(), value => value);
  const held = R.countBy(
    values.flatMap((list, i) => (privateIndices.has(i) ? list : [])),
    value => value
  );
  return Math.max(
    ...Object.keys(all).map(value =>
      Math.abs((held[value] ?? 0) - all[value]! * share)
    )
  );
}

describe("balancePrivateIndices", () => {
  it("brings every value within a seed of the overall private share", () => {
    const corpus = makeCorpus(1);
    const balanced = balancePrivateIndices(corpus);
    expect(largestGap(corpus.values, corpus.privateIndices)).toBeGreaterThan(2);
    expect(largestGap(corpus.values, balanced)).toBeLessThanOrEqual(1);
  });

  it("keeps the number of private seeds of every swap set", () => {
    const corpus = makeCorpus(2);
    const balanced = balancePrivateIndices(corpus);
    const perSet = (indices: ReadonlySet<number>) =>
      R.countBy([...indices], i => corpus.swapKeys[i]!);
    expect(balanced.size).toBe(corpus.privateIndices.size);
    expect(perSet(balanced)).toEqual(perSet(corpus.privateIndices));
  });

  it("yields the same split for the same random seed", () => {
    const sorted = (seed: number) =>
      [...balancePrivateIndices(makeCorpus(seed))].sort((a, b) => a - b);
    expect(sorted(5)).toEqual(sorted(5));
  });

  it("leaves an empty or a full split alone", () => {
    const {swapKeys, values, rng} = makeCorpus(3);
    const none = new Set<number>();
    const all = new Set(swapKeys.map((_, i) => i));
    expect(
      balancePrivateIndices({privateIndices: none, swapKeys, values, rng})
    ).toBe(none);
    expect(
      balancePrivateIndices({privateIndices: all, swapKeys, values, rng})
    ).toBe(all);
  });

  it("rejects value lists that do not match the seeds", () => {
    const {swapKeys, privateIndices, rng} = makeCorpus(4);
    expect(() =>
      balancePrivateIndices({privateIndices, swapKeys, values: [], rng})
    ).toThrow(/value lists/);
  });
});
