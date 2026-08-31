import * as R from "remeda";
import * as v from "valibot";
import {PackId} from "../packs/packId.js";
import {Packs} from "../packs/packs.js";
import {Risk} from "./risk.js";

//
// Runtime model.
//

const VRiskCategory = v.object({
  id: PackId.io,
  name: v.string(),
  risks: v.pipe(v.array(Risk.io), v.readonly()),
});

//
// API.
//
// These read the *active* pack rather than a bundled file, so the same call
// resolves differently inside `Packs.run(...)`. Validation (flavor proportions,
// id uniqueness) now happens once per pack in `RiskTaxonomy.parse`, which is why
// there is no memoization here — this is a property read, not a parse.
//

function listAll(): readonly RiskCategory[] {
  return Packs.current().taxonomy.categories;
}

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
