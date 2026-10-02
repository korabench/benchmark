import {describe, expect, it} from "vitest";
import {populationDistributionPresets} from "../../model/populationDistributionPresets.js";
import {allocatePersonas, PinnedDemographics} from "../allocatePersonas.js";
import {makeRng} from "../rng.js";

const census = populationDistributionPresets["us-children-2020"]!;

/**
 * Each count must be floor(total * p) or one more, and the counts sum to
 * `total`. Which values get the +1 is random by design.
 */
function expectWithinRounding(
  counts: Record<string, number>,
  proportions: Record<string, number>,
  total: number
): void {
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total);
  for (const [key, p] of Object.entries(proportions)) {
    const floor = Math.floor(p * total);
    expect([floor, floor + 1]).toContain(counts[key] ?? 0);
  }
}

function histogram<K extends keyof PinnedDemographics>(
  personas: readonly PinnedDemographics[],
  field: K
): Record<string, number> {
  return personas.reduce<Record<string, number>>((acc, p) => {
    const key = String(p[field]);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

describe("allocatePersonas", () => {
  it("produces exactly `total` personas with matching marginals (US census @ 60)", () => {
    const personas = allocatePersonas(census, 60, makeRng(42));
    expect(personas).toHaveLength(60);
    expectWithinRounding(histogram(personas, "ageRange"), census.ageRange, 60);
    expectWithinRounding(histogram(personas, "gender"), census.gender, 60);
    expectWithinRounding(histogram(personas, "ses"), census.ses, 60);
    expectWithinRounding(
      histogram(personas, "raceEthnicity"),
      census.raceEthnicity,
      60
    );
  });

  it("does not always hand the rounding remainder to the same value", () => {
    // 35/29/36 over 40 leaves 14/11.6/14.4: the +1 must move around.
    const sesCounts = Array.from({length: 50}, (_, i) =>
      histogram(allocatePersonas(census, 40, makeRng(i)), "ses")
    );
    const floors: Record<string, number> = {low: 14, middle: 11, high: 14};
    const winners = new Set(
      sesCounts.flatMap(c =>
        Object.keys(floors).filter(key => c[key] === floors[key]! + 1)
      )
    );
    expect(winners.size).toBeGreaterThan(1);
  });

  it("is reproducible given the same seed", () => {
    const a = allocatePersonas(census, 60, makeRng(123));
    const b = allocatePersonas(census, 60, makeRng(123));
    expect(a).toEqual(b);
  });

  it("produces different joint assignments for different seeds, both within rounding", () => {
    const a = allocatePersonas(census, 60, makeRng(1));
    const b = allocatePersonas(census, 60, makeRng(2));
    expect(a).not.toEqual(b);
    expectWithinRounding(histogram(a, "ses"), census.ses, 60);
    expectWithinRounding(histogram(b, "ses"), census.ses, 60);
    expectWithinRounding(
      histogram(a, "raceEthnicity"),
      census.raceEthnicity,
      60
    );
  });

  it("handles total=1", () => {
    const personas = allocatePersonas(census, 1, makeRng(0));
    expect(personas).toHaveLength(1);
  });

  it("handles total=0", () => {
    expect(allocatePersonas(census, 0, makeRng(0))).toEqual([]);
  });

  it("restricts to allowed age ranges (single band → 100% in that band)", () => {
    const personas = allocatePersonas(census, 60, makeRng(7), ["10to12"]);
    expect(personas).toHaveLength(60);
    expect(histogram(personas, "ageRange")).toEqual({"10to12": 60});
    // Other dimensions should still match the preset marginals.
    expectWithinRounding(histogram(personas, "gender"), census.gender, 60);
  });

  it("renormalizes proportions across allowed age ranges", () => {
    // Allowed: 10to12 (0.27) + 13to17 (0.46) = 0.73
    // → renormalized: 10to12 = 0.27/0.73 ≈ 0.37, 13to17 ≈ 0.63
    // Over 60 → 10to12: 22, 13to17: 38
    const personas = allocatePersonas(census, 60, makeRng(5), [
      "10to12",
      "13to17",
    ]);
    const hist = histogram(personas, "ageRange");
    expect(hist["7to9"] ?? 0).toBe(0);
    expect((hist["10to12"] ?? 0) + (hist["13to17"] ?? 0)).toBe(60);
    expect(hist["10to12"]).toBe(22);
    expect(hist["13to17"]).toBe(38);
  });
});
