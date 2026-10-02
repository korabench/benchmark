import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {makeRng} from "../rng.js";
import {selectPrivateIndices} from "../selectPrivateIndices.js";

describe("selectPrivateIndices", () => {
  it("selects exactly total * ratio indices when that is an integer", () => {
    const selected = selectPrivateIndices(100, 0.3, makeRng(1));
    expect(selected.size).toBe(30);
    expect([...selected].every(i => i >= 0 && i < 100)).toBe(true);
  });

  it("absorbs float noise in total * ratio", () => {
    // 0.3 * 90 = 27.000000000000004
    expect(selectPrivateIndices(90, 0.3, makeRng(1)).size).toBe(27);
  });

  it("rounds total * ratio to the nearest integer, halves up, every time", () => {
    const rng = makeRng(7);
    // 75 * 0.3 = 22.5, 74 * 0.3 = 22.2, 15 * 0.3 = 4.5 (4.4999… in floats).
    const sizes = R.times(200, () => selectPrivateIndices(75, 0.3, rng).size);
    expect(R.unique(sizes)).toEqual([23]);
    expect(selectPrivateIndices(74, 0.3, rng).size).toBe(22);
    expect(selectPrivateIndices(15, 0.3, rng).size).toBe(5);
  });

  it("selects every index about equally often", () => {
    const rng = makeRng(3);
    const selections = R.times(4000, () => selectPrivateIndices(10, 0.3, rng));
    const hits = R.times(
      10,
      i => selections.filter(selected => selected.has(i)).length
    );
    hits.forEach(n => expect(n / 4000).toBeCloseTo(0.3, 1));
  });

  it("selects nothing at ratio 0 without drawing, and everything at 1", () => {
    const rng = makeRng(5);
    const before = makeRng(5)();
    expect(selectPrivateIndices(20, 0, rng).size).toBe(0);
    expect(rng()).toBe(before);
    expect(selectPrivateIndices(20, 1, makeRng(5)).size).toBe(20);
  });

  it("is reproducible for a given rng seed", () => {
    expect([...selectPrivateIndices(75, 0.3, makeRng(42))]).toEqual([
      ...selectPrivateIndices(75, 0.3, makeRng(42)),
    ]);
  });

  it("rejects a ratio outside [0, 1]", () => {
    expect(() => selectPrivateIndices(10, 1.2, makeRng(1))).toThrow();
    expect(() => selectPrivateIndices(10, -0.1, makeRng(1))).toThrow();
  });
});
