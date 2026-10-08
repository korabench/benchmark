import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {allocateAges} from "../allocateAges.js";
import {allocateUniform} from "../allocateUniform.js";
import {makeRng} from "../rng.js";

const values = ["a", "b", "c"] as const;

describe("allocateUniform", () => {
  it("splits evenly when total is a multiple of the value count", () => {
    const out = allocateUniform(values, 30, makeRng(1));
    expect(out).toHaveLength(30);
    expect(R.countBy(out, x => x)).toEqual({a: 10, b: 10, c: 10});
  });

  it("keeps every count within one of the others otherwise", () => {
    const out = allocateUniform(values, 10, makeRng(1));
    expect(out).toHaveLength(10);
    expect(Object.values(R.countBy(out, x => x)).sort()).toEqual([3, 3, 4]);
  });

  it("rotates which value receives the remainder", () => {
    const favoured = Array.from({length: 40}, (_, seed) => {
      const counts = R.countBy(
        allocateUniform(values, 10, makeRng(seed)),
        x => x
      );
      return values.find(value => counts[value] === 4);
    });
    expect(new Set(favoured)).toEqual(new Set(values));
  });

  it("shuffles the order", () => {
    const out = allocateUniform(values, 30, makeRng(3));
    // Not the unshuffled a…a b…b c…c block layout.
    expect(out.join("")).not.toBe(
      "a".repeat(10) + "b".repeat(10) + "c".repeat(10)
    );
  });

  it("is reproducible given the same seed and varies across seeds", () => {
    expect(allocateUniform(values, 30, makeRng(9))).toEqual(
      allocateUniform(values, 30, makeRng(9))
    );
    expect(allocateUniform(values, 30, makeRng(9))).not.toEqual(
      allocateUniform(values, 30, makeRng(10))
    );
  });

  it("handles a total smaller than the value count", () => {
    const out = allocateUniform(values, 2, makeRng(4));
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
  });

  it("handles total=0", () => {
    expect(allocateUniform(values, 0, makeRng(0))).toEqual([]);
  });

  it("rejects an empty value list and a non-integer total", () => {
    expect(() => allocateUniform([], 3, makeRng(0))).toThrow(/non-empty/);
    expect(() => allocateUniform(values, 1.5, makeRng(0))).toThrow(
      /non-negative integer/
    );
    expect(() => allocateUniform(values, -1, makeRng(0))).toThrow(
      /non-negative integer/
    );
  });
});

describe("allocateAges", () => {
  it("returns one age per seed, inside that seed's band", () => {
    const bands = [
      ...Array.from({length: 6}, () => "7to9" as const),
      ...Array.from({length: 6}, () => "10to12" as const),
      ...Array.from({length: 10}, () => "13to17" as const),
    ];
    const ages = allocateAges(bands, makeRng(2));

    expect(ages).toHaveLength(bands.length);
    expect(ages.slice(0, 6).every(a => a >= 7 && a <= 9)).toBe(true);
    expect(ages.slice(6, 12).every(a => a >= 10 && a <= 12)).toBe(true);
    expect(ages.slice(12).every(a => a >= 13 && a <= 17)).toBe(true);
  });

  it("spreads ages evenly over the years of each band", () => {
    const bands = [
      ...Array.from({length: 6}, () => "7to9" as const),
      ...Array.from({length: 10}, () => "13to17" as const),
    ];
    const ages = allocateAges(bands, makeRng(2));

    expect(R.countBy(ages.slice(0, 6), a => String(a))).toEqual({
      "7": 2,
      "8": 2,
      "9": 2,
    });
    expect(R.countBy(ages.slice(6), a => String(a))).toEqual({
      "13": 2,
      "14": 2,
      "15": 2,
      "16": 2,
      "17": 2,
    });
  });

  it("handles interleaved bands and an empty input", () => {
    const bands = ["13to17", "7to9", "13to17", "7to9"] as const;
    const ages = allocateAges(bands, makeRng(5));
    expect(ages[0]).toBeGreaterThanOrEqual(13);
    expect(ages[1]).toBeLessThanOrEqual(9);
    expect(ages[2]).toBeGreaterThanOrEqual(13);
    expect(ages[3]).toBeLessThanOrEqual(9);
    // Two seeds in a band get two different years.
    expect(ages[0]).not.toBe(ages[2]);
    expect(ages[1]).not.toBe(ages[3]);

    expect(allocateAges([], makeRng(0))).toEqual([]);
  });
});
