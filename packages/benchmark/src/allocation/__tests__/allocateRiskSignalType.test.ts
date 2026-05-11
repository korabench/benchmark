import {describe, expect, it} from "vitest";
import {
  allocateRiskSignalTypes,
  RiskSignalType,
} from "../allocateRiskSignalType.js";
import {makeRng} from "../rng.js";

function histogram(
  values: readonly RiskSignalType[]
): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
}

describe("allocateRiskSignalTypes", () => {
  it("allocates exactly 20/40/40 at total=10", () => {
    const out = allocateRiskSignalTypes(10, makeRng(1));
    expect(out).toHaveLength(10);
    expect(histogram(out)).toEqual({direct: 2, subtle: 4, ambiguous: 4});
  });

  it("scales the 20/40/40 marginals exactly at total=20", () => {
    const out = allocateRiskSignalTypes(20, makeRng(7));
    expect(out).toHaveLength(20);
    expect(histogram(out)).toEqual({direct: 4, subtle: 8, ambiguous: 8});
  });

  it("is reproducible given the same RNG seed", () => {
    const a = allocateRiskSignalTypes(30, makeRng(99));
    const b = allocateRiskSignalTypes(30, makeRng(99));
    expect(a).toEqual(b);
  });

  it("returns an empty array for total=0", () => {
    expect(allocateRiskSignalTypes(0, makeRng(1))).toEqual([]);
  });

  it("respects the 20% direct floor at small totals via largest-remainder", () => {
    // total=5 → exact: direct=1, subtle=2, ambiguous=2 (floor=1+0+0=1, remainders give direct lowest, so subtle/ambiguous get the bonuses)
    const out = allocateRiskSignalTypes(5, makeRng(3));
    const h = histogram(out);
    expect(h.direct).toBe(1);
    expect(h.subtle).toBe(2);
    expect(h.ambiguous).toBe(2);
  });
});
