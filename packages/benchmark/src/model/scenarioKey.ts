import {unreachable} from "@korabench/core";
import * as v from "valibot";
import {AgeRange} from "./ageRange.js";
import {Scenario} from "./scenario.js";

//
// Runtime type.
//

const VScenarioPrompt = v.picklist(["default", "child"]);

const VScenarioKey = v.strictObject({
  riskCategoryId: v.string(),
  riskId: v.string(),
  ageRange: AgeRange.io,
  id: v.string(),
  prompt: VScenarioPrompt,
});

//
// Type exports.
//

export type ScenarioPrompt = v.InferOutput<typeof VScenarioPrompt>;
export interface ScenarioKey extends v.InferOutput<typeof VScenarioKey> {}

//
// API.
//

function promptToAgeRange(ageRange: AgeRange, prompt: ScenarioPrompt) {
  switch (prompt) {
    case "default":
      return undefined;

    case "child":
      return ageRange;

    default:
      unreachable(prompt);
  }
}

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
  return promptToAgeRange(key.ageRange, key.prompt);
}

//
// Exports.
//

export const ScenarioPrompt = {
  io: VScenarioPrompt,
  list: VScenarioPrompt.options,
  toAgeRange: promptToAgeRange,
};

export const ScenarioKey = {
  io: VScenarioKey,
  ofString: keyOfString,
  ofScenario: keyOfScenario,
  toString: keyToString,
  toAgeRange: keyToAgeRange,
};
