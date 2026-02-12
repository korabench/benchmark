import * as v from "valibot";
import {AgeRange} from "./ageRange.js";
import {Motivation} from "./motivation.js";
import {ScenarioSeed} from "./scenarioSeed.js";

//
// Runtime type.
//

const VScenarioSeedSlice = v.object({
  riskCategoryId: v.string(),
  riskId: v.string(),
  ageRange: AgeRange.io,
  motivation: Motivation.io,
  seeds: v.pipe(v.array(ScenarioSeed.io), v.readonly()),
});

//
// Exports.
//

export interface ScenarioSeedSlice extends v.InferOutput<
  typeof VScenarioSeedSlice
> {}
export const ScenarioSeedSlice = {
  io: VScenarioSeedSlice,
};
