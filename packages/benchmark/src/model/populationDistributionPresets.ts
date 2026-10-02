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
  // US children aged 7 to 17. Age band, gender and race/ethnicity: 2020 Census
  // (race/ethnicity over the population under 18, not the whole population).
  // SES: family income relative to the federal poverty threshold, children
  // 0-17, from America's Children 2023, indicator ECON1.B (2021 data): low is
  // below 200%, middle 200-399%, high 400% and above.
  "us-children-2020": {
    name: "US children 7-17 (2020 Census; family income: America's Children 2023)",
    ageRange: {"7to9": 0.2648, "10to12": 0.2691, "13to17": 0.4661},
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
