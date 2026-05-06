import * as fs from "node:fs/promises";
import * as v from "valibot";
import {populationDistributionPresets} from "./populationDistributionPresets.js";

//
// Schema.
//

const VProportion = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

const VAgeRangeDist = v.strictObject({
  "7to9": VProportion,
  "10to12": VProportion,
  "13to17": VProportion,
});

const VGenderDist = v.strictObject({
  girl: VProportion,
  boy: VProportion,
});

const VSESDist = v.strictObject({
  low: VProportion,
  middle: VProportion,
  high: VProportion,
});

const VRaceEthnicityDist = v.strictObject({
  white: VProportion,
  hispanic: VProportion,
  black: VProportion,
  asian: VProportion,
  other: VProportion,
});

const VPopulationDistribution = v.strictObject({
  name: v.string(),
  ageRange: VAgeRangeDist,
  gender: VGenderDist,
  ses: VSESDist,
  raceEthnicity: VRaceEthnicityDist,
});

//
// API.
//

const SUM_TOLERANCE = 1e-6;

function assertSumsToOne(
  dimensionName: string,
  values: Record<string, number>
): void {
  const sum = Object.values(values).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error(
      `Population distribution dimension "${dimensionName}" proportions sum to ${sum}, expected 1.0.`
    );
  }
}

function validate(distribution: PopulationDistribution): void {
  assertSumsToOne("ageRange", distribution.ageRange);
  assertSumsToOne("gender", distribution.gender);
  assertSumsToOne("ses", distribution.ses);
  assertSumsToOne("raceEthnicity", distribution.raceEthnicity);
}

/**
 * Resolve `specifier` to a PopulationDistribution.
 *
 * - If `specifier` matches a preset name (e.g. "us-census-2020") → return it.
 * - Otherwise treat `specifier` as a path to a JSON file and parse it.
 */
async function resolve(specifier: string): Promise<PopulationDistribution> {
  const preset = populationDistributionPresets[specifier];
  if (preset) {
    validate(preset);
    return preset;
  }

  const raw = await fs.readFile(specifier, "utf-8");
  const parsed = v.parse(VPopulationDistribution, JSON.parse(raw));
  validate(parsed);
  return parsed;
}

//
// Exports.
//

export interface PopulationDistribution extends v.InferOutput<
  typeof VPopulationDistribution
> {}

export const PopulationDistribution = {
  io: VPopulationDistribution,
  validate,
  resolve,
  presetNames: (): readonly string[] =>
    Object.keys(populationDistributionPresets),
};
