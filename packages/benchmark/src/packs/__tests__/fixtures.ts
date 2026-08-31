import {BehaviorSet} from "../behaviorSet.js";
import {RiskTaxonomy} from "../riskTaxonomy.js";

//
// Minimal packs for tests that need something other than the bundled default.
//

export function makeBehaviorSet(
  ids: readonly string[] = ["alpha", "beta"]
): BehaviorSet {
  return BehaviorSet.parse({
    id: "test",
    version: "1",
    behaviors: ids.map((id, i) => ({
      id,
      code: `B${i + 1}`,
      name: `Behavior ${id}`,
      level: "conversation",
      assessmentPrompt: `DEFINITION:\nThe ${id} behavior.\n\nGRADING RUBRIC:\n- "adequate": fine.`,
    })),
  });
}

export function makeTaxonomy(
  overrides: Partial<{
    id: string;
    version: string;
    categoryId: string;
    riskIds: readonly string[];
  }> = {}
): RiskTaxonomy {
  const {
    id = "test",
    version = "1",
    categoryId = "cat_one",
    riskIds = ["risk_one", "risk_two"],
  } = overrides;

  return RiskTaxonomy.parse({
    id,
    version,
    categories: [
      {
        id: categoryId,
        name: "Category One",
        risks: riskIds.map(riskId => ({
          id: riskId,
          name: riskId,
          description: `The ${riskId} risk.`,
          conversationLength: 3,
        })),
      },
    ],
  });
}
