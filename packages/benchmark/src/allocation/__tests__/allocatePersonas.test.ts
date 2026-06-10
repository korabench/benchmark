import {describe, expect, it} from "vitest";
import {populationDistributionPresets} from "../../model/populationDistributionPresets.js";
import {allocatePersonas, PinnedDemographics} from "../allocatePersonas.js";
import {makeRng} from "../rng.js";

const census = populationDistributionPresets["us-census-2020"]!;

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
    expect(histogram(personas, "ageRange")).toEqual({
      "7to9": 16,
      "10to12": 16,
      "13to17": 28,
    });
    expect(histogram(personas, "gender")).toEqual({girl: 30, boy: 30});
    expect(histogram(personas, "ses")).toEqual({
      low: 17,
      middle: 28,
      high: 15,
    });
    expect(histogram(personas, "raceEthnicity")).toEqual({
      white: 31,
      hispanic: 15,
      black: 8,
      asian: 3,
      other: 3,
    });
  });

  it("is reproducible given the same seed", () => {
    const a = allocatePersonas(census, 60, makeRng(123));
    const b = allocatePersonas(census, 60, makeRng(123));
    expect(a).toEqual(b);
  });

  it("produces different joint assignments for different seeds but identical marginals", () => {
    const a = allocatePersonas(census, 60, makeRng(1));
    const b = allocatePersonas(census, 60, makeRng(2));
    expect(a).not.toEqual(b);
    expect(histogram(a, "ses")).toEqual(histogram(b, "ses"));
    expect(histogram(a, "raceEthnicity")).toEqual(
      histogram(b, "raceEthnicity")
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
    expect(histogram(personas, "gender")).toEqual({girl: 30, boy: 30});
  });

  it("produces exact uniform marginals for cognitive and emotional maturity (60 → 20/20/20)", () => {
    const personas = allocatePersonas(census, 60, makeRng(42));
    expect(histogram(personas, "cognitiveMaturity")).toEqual({
      low: 20,
      medium: 20,
      high: 20,
    });
    expect(histogram(personas, "emotionalMaturity")).toEqual({
      low: 20,
      medium: 20,
      high: 20,
    });
  });

  it("draws childAge as an integer within the pinned bracket for every persona", () => {
    const personas = allocatePersonas(census, 120, makeRng(13));
    const inBracket = {
      "7to9": new Set([7, 8, 9]),
      "10to12": new Set([10, 11, 12]),
      "13to17": new Set([13, 14, 15, 16, 17]),
    } as const;
    for (const p of personas) {
      expect(Number.isInteger(p.childAge)).toBe(true);
      expect(inBracket[p.ageRange].has(p.childAge)).toBe(true);
    }
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
