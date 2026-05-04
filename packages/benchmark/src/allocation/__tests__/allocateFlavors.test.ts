import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {ScenarioFlavor} from "../../model/scenarioFlavor.js";
import {allocateFlavors} from "../allocateFlavors.js";
import {makeRng} from "../rng.js";

const FLAVORS: readonly ScenarioFlavor[] = [
  {id: "a_direct", proportion: 0.25, description: ""},
  {id: "b_gradual", proportion: 0.4, description: ""},
  {id: "d_authority", proportion: 0.2, description: ""},
  {id: "e_fictional", proportion: 0.15, description: ""},
];

describe("allocateFlavors", () => {
  it("produces exactly `total` ids", () => {
    const rng = makeRng(1);
    expect(allocateFlavors(FLAVORS, 20, rng)).toHaveLength(20);
  });

  it("matches the largest-remainder marginals", () => {
    const rng = makeRng(1);
    const ids = allocateFlavors(FLAVORS, 20, rng);
    expect(R.countBy(ids, x => x)).toEqual({
      a_direct: 5,
      b_gradual: 8,
      d_authority: 4,
      e_fictional: 3,
    });
  });

  it("produces no flavors when total is 0", () => {
    expect(allocateFlavors(FLAVORS, 0, makeRng(1))).toEqual([]);
  });

  it("is reproducible across runs with the same seed", () => {
    const a = allocateFlavors(FLAVORS, 50, makeRng(42));
    const b = allocateFlavors(FLAVORS, 50, makeRng(42));
    expect(a).toEqual(b);
  });

  it("shuffles — does not return ids grouped by flavor", () => {
    const ids = allocateFlavors(FLAVORS, 50, makeRng(7));
    const groupedRuns = ids.reduce<string[]>((acc, id) => {
      if (acc[acc.length - 1] !== id) acc.push(id);
      return acc;
    }, []);
    // A purely sorted output would yield 4 runs (one per flavor). A real
    // shuffle should produce many more transitions than that.
    expect(groupedRuns.length).toBeGreaterThan(4);
  });
});
