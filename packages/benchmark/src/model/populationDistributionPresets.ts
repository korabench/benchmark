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
  "us-census-2023": {
    name: "US Census 2023 (children 7-17)",
    ageRange: {"7to9": 0.27, "10to12": 0.27, "13to17": 0.46},
    gender: {girl: 0.488, boy: 0.512},
    ses: {low: 0.35, middle: 0.29, high: 0.36},
    raceEthnicity: {
      white: 0.473,
      hispanic: 0.257,
      black: 0.132,
      asian: 0.053,
      other: 0.085,
    },
  },
};
