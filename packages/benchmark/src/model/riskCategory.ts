import {memoize} from "@korabench/core";
import * as R from "remeda";
import * as v from "valibot";
import risks from "../../data/risks.json" with {type: "json"};
import {Risk} from "./risk.js";
import {assertFlavorsSumToOne} from "./scenarioFlavor.js";

//
// Runtime model.
//

const VRiskCategory = v.object({
  id: v.string(),
  name: v.string(),
  risks: v.pipe(v.array(Risk.io), v.readonly()),
});

//
// API.
//

const listAll = memoize(() => {
  const type = v.pipe(v.array(VRiskCategory), v.readonly());
  const parsed = v.parse(type, risks);
  for (const category of parsed) {
    for (const risk of category.risks) {
      if (risk.scenarioFlavors) {
        assertFlavorsSumToOne(risk.id, risk.scenarioFlavors);
      }
    }
  }
  return parsed;
});

function find(riskCategoryId: string) {
  const result = listAll().find(r => r.id === riskCategoryId);
  if (!result) {
    throw new Error("Risk category not found.");
  }

  return result;
}

function findAnyRisk(riskId: string) {
  return R.pipe(
    listAll(),
    R.flatMap(r => r.risks),
    R.find(r => r.id === riskId)
  );
}

function findRisk(riskCategory: RiskCategory, riskId: string) {
  const result = riskCategory.risks.find(r => r.id === riskId);
  if (!result) {
    throw new Error("Risk not found in category.");
  }

  return result;
}

//
// Exports.
//

export interface RiskCategory extends v.InferOutput<typeof VRiskCategory> {}

export const RiskCategory = {
  io: VRiskCategory,
  listAll,
  find,
  findAnyRisk,
  findRisk,
};
