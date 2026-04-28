import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {RunSums} from "../runResult.js";

describe("RunSums.io (per-mechanism tuple parsing)", () => {
  it("parses current 5-tuples [f, a, e, occ, notTriggered] unchanged", () => {
    const result = v.parse(RunSums.io, {
      al: 1,
      as: [0, 1, 0],
      mechanisms: {
        sycophancy: [1, 2, 3, 4, 5],
      },
    });

    expect(result.mechanisms.sycophancy).toEqual([1, 2, 3, 4, 5]);
  });

  it("pads legacy 4-tuples with notTriggered=0 for backward compatibility", () => {
    // Older results.json baselines were written before the notTriggered slot
    // existed. They must keep parsing without manual migration.
    const result = v.parse(RunSums.io, {
      al: 1,
      as: [0, 1, 0],
      mechanisms: {
        sycophancy: [1, 2, 3, 4],
      },
    });

    expect(result.mechanisms.sycophancy).toEqual([1, 2, 3, 4, 0]);
  });

  it("rejects malformed mechanism tuples", () => {
    expect(() =>
      v.parse(RunSums.io, {
        al: 1,
        as: [0, 1, 0],
        mechanisms: {
          sycophancy: [1, 2, 3], // too short
        },
      })
    ).toThrow();
  });
});
