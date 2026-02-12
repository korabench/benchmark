import {unreachable} from "@korabench/core";
import * as v from "valibot";
import {AgeRange} from "./ageRange.js";

//
// Runtime type.
//

const VScenarioPrompt = v.picklist(["default", "child"]);

//
// Type exports.
//

export type ScenarioPrompt = v.InferOutput<typeof VScenarioPrompt>;

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

//
// Exports.
//

export const ScenarioPrompt = {
  io: VScenarioPrompt,
  list: VScenarioPrompt.options,
  toAgeRange: promptToAgeRange,
};
