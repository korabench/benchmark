import * as v from "valibot";
import {AgeRange} from "./ageRange.js";
import {Scenario} from "./scenario.js";
import {ScenarioPrompt} from "./scenarioPrompt.js";

//
// Runtime type.
//

const VScenarioKey = v.strictObject({
  riskCategoryId: v.string(),
  riskId: v.string(),
  ageRange: AgeRange.io,
  id: v.string(),
  prompt: ScenarioPrompt.io,
});

//
// Type exports.
//

export {ScenarioPrompt} from "./scenarioPrompt.js";
export interface ScenarioKey extends v.InferOutput<typeof VScenarioKey> {}

//
// API.
//

function keyOfString(src: string): ScenarioKey {
  const values = src.split(":");
  return v.parse(VScenarioKey, {
    riskCategoryId: values[0],
    riskId: values[1],
    ageRange: values[2],
    id: values[3],
    prompt: values[4],
  });
}

function keyOfScenario(src: Scenario, prompt: ScenarioPrompt): ScenarioKey {
  return {
    riskCategoryId: src.seed.riskCategoryId,
    riskId: src.seed.riskId,
    ageRange: src.seed.ageRange,
    id: src.seed.id,
    prompt,
  };
}

function keyToString(key: ScenarioKey): string {
  return `${key.riskCategoryId}:${key.riskId}:${key.ageRange}:${key.id}:${key.prompt}`;
}

function keyToAgeRange(key: ScenarioKey) {
  return ScenarioPrompt.toAgeRange(key.ageRange, key.prompt);
}

//
// Exports.
//

export const ScenarioKey = {
  io: VScenarioKey,
  ofString: keyOfString,
  ofScenario: keyOfScenario,
  toString: keyToString,
  toAgeRange: keyToAgeRange,
};
