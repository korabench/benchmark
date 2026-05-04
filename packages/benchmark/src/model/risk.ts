import * as v from "valibot";
import {ScenarioFlavor} from "./scenarioFlavor.js";

//
// Runtime model.
//

const VRisk = v.object({
  id: v.string(),
  name: v.string(),
  description: v.string(),
  scenarioGuidance: v.optional(v.string()),
  scenarioFlavors: v.optional(v.array(ScenarioFlavor.io)),
  provideUserContext: v.optional(v.boolean()),
  conversationLength: v.number(),
});

//
// Exports.
//

export interface Risk extends v.InferOutput<typeof VRisk> {}

export const Risk = {
  io: VRisk,
};
