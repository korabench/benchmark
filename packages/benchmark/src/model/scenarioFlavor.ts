import * as v from "valibot";

const SUM_TOLERANCE = 1e-6;

const VFlavorRiskSignalType = v.picklist(["direct", "subtle", "ambiguous"]);

const VScenarioFlavor = v.strictObject({
  id: v.string(),
  proportion: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  description: v.string(),
  conversationLength: v.optional(v.number()),
  riskSignalType: v.optional(VFlavorRiskSignalType),
});

export interface ScenarioFlavor extends v.InferOutput<typeof VScenarioFlavor> {}

export function assertFlavorsSumToOne(
  riskId: string,
  flavors: readonly ScenarioFlavor[]
): void {
  const sum = flavors.reduce((acc, f) => acc + f.proportion, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error(
      `Risk "${riskId}" scenarioFlavors proportions sum to ${sum}, expected 1.0.`
    );
  }
  const ids = flavors.map(f => f.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      `Risk "${riskId}" scenarioFlavors contain duplicate ids: ${ids.join(", ")}.`
    );
  }
}

export const ScenarioFlavor = {
  io: VScenarioFlavor,
};
