import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {largestRemainderCounts} from "../largestRemainder.js";

describe("largestRemainderCounts", () => {
  it("splits an even 50/50 at 10 into 5/5", () => {
    expect(largestRemainderCounts({a: 0.5, b: 0.5}, 10)).toEqual({a: 5, b: 5});
  });

  it("handles exact proportions with no remainder", () => {
    expect(largestRemainderCounts({a: 0.25, b: 0.75}, 100)).toEqual({
      a: 25,
      b: 75,
    });
  });

  it("matches the user's SES example: 28/46/26 over 60 → 17/28/15", () => {
    expect(
      largestRemainderCounts({low: 0.28, middle: 0.46, high: 0.26}, 60)
    ).toEqual({low: 17, middle: 28, high: 15});
  });

  it("matches the US census race example at 60 → 31/15/8/3/3", () => {
    expect(
      largestRemainderCounts(
        {
          white: 0.51,
          hispanic: 0.25,
          black: 0.13,
          asian: 0.05,
          other: 0.06,
        },
        60
      )
    ).toEqual({white: 31, hispanic: 15, black: 8, asian: 3, other: 3});
  });

  it("matches the age example: 27/27/46 over 60 → 16/16/28", () => {
    expect(
      largestRemainderCounts({"7to9": 0.27, "10to12": 0.27, "13to17": 0.46}, 60)
    ).toEqual({"7to9": 16, "10to12": 16, "13to17": 28});
  });

  it("handles a single category", () => {
    expect(largestRemainderCounts({a: 1}, 7)).toEqual({a: 7});
  });

  it("returns zeros for total=0", () => {
    expect(largestRemainderCounts({a: 0.5, b: 0.5}, 0)).toEqual({a: 0, b: 0});
  });

  it("breaks ties deterministically by key-insertion order", () => {
    // Both a and b have remainder 0.5 at total=3; earliest key wins.
    expect(largestRemainderCounts({a: 0.5, b: 0.5}, 3)).toEqual({a: 2, b: 1});
  });

  it("always sums to total for random proportions (property)", () => {
    const rng = R.randomInteger;
    for (let i = 0; i < 50; i++) {
      const raw = Array.from({length: 5}, () => rng(1, 100));
      const sum = raw.reduce((a, b) => a + b, 0);
      const proportions = Object.fromEntries(
        raw.map((v, idx) => [`k${idx}`, v / sum])
      ) as Record<string, number>;
      const total = rng(0, 1000);
      const counts = largestRemainderCounts(proportions, total);
      const s = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(s).toBe(total);
    }
  });

  it("rejects proportions not summing to 1", () => {
    expect(() => largestRemainderCounts({a: 0.3, b: 0.3}, 10)).toThrow(
      /sum to/
    );
  });

  it("rejects negative total", () => {
    expect(() => largestRemainderCounts({a: 1}, -1)).toThrow(
      /non-negative integer/
    );
  });

  it("rejects empty proportions", () => {
    expect(() => largestRemainderCounts({}, 10)).toThrow(/non-empty/);
  });
});
