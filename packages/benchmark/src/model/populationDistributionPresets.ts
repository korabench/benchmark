import type {PopulationDistribution} from "./populationDistribution.js";

/**
 * Built-in population-distribution presets.
 *
 * Proportions are marginals and must sum to 1 per dimension.
 * Integer persona counts are derived via the largest-remainder method
 * at allocation time.
 */
export const populationDistributionPresets: Record<
  string,
  PopulationDistribution
> = {
  "us-census-2020": {
    name: "US Census 2020 (children 7-17)",
    ageRange: {"7to9": 0.27, "10to12": 0.27, "13to17": 0.46},
    gender: {girl: 0.5, boy: 0.5},
    ses: {low: 0.28, middle: 0.46, high: 0.26},
    raceEthnicity: {
      white: 0.51,
      hispanic: 0.25,
      black: 0.13,
      asian: 0.05,
      other: 0.06,
    },
  },
};
