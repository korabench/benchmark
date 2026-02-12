import * as v from "valibot";

//
// Runtime model.
//

const VRisk = v.object({
  id: v.string(),
  name: v.string(),
  description: v.string(),
  scenarioGuidance: v.optional(v.string()),
  provideUserContext: v.optional(v.boolean()),
});

//
// Exports.
//

export interface Risk extends v.InferOutput<typeof VRisk> {}

export const Risk = {
  io: VRisk,
};
