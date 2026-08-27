import {Hash} from "@korabench/core";
import * as R from "remeda";
import * as v from "valibot";
import {Motivation} from "../model/motivation.js";
import {RiskCategory} from "../model/riskCategory.js";
import {assertFlavorsSumToOne} from "../model/scenarioFlavor.js";
import {PackId} from "./packId.js";
import {stableJson} from "./stableJson.js";

//
// Runtime model.
//
// Built on first use rather than at module scope. `model/riskCategory.ts` reads
// the active pack, so it imports `packs.ts`, which reaches `bundled.ts` and
// back here — touching `RiskCategory.io` during that cycle would read a
// half-initialized module. Deferring the build sidesteps it entirely.
//

let schema: RiskTaxonomySchema | undefined;

function io(): RiskTaxonomySchema {
  return (schema ??= v.object({
    id: PackId.io,
    version: v.string(),
    name: v.optional(v.string()),
    categories: v.pipe(v.array(RiskCategory.io), v.readonly()),
    /**
     * Seed-generation motivations. Optional so a taxonomy can inherit the
     * bundled set rather than restate it.
     */
    motivations: v.optional(v.pipe(v.array(Motivation.io), v.readonly())),
  }));
}

//
// API.
//

function label(taxonomy: RiskTaxonomy): string {
  return `${taxonomy.id}@${taxonomy.version}`;
}

function allRisks(taxonomy: RiskTaxonomy) {
  return R.flatMap(taxonomy.categories, c => c.risks);
}

function parse(data: unknown): RiskTaxonomy {
  const taxonomy = v.parse(io(), data);
  const scope = `Risk taxonomy "${label(taxonomy)}"`;

  if (taxonomy.categories.length === 0) {
    throw new Error(`${scope} contains no risk categories.`);
  }
  PackId.assertUnique(
    taxonomy.categories.map(c => c.id),
    "risk category",
    scope
  );
  // Risk ids must be unique across the *whole* taxonomy, not just within a
  // category: `RiskCategory.findAnyRisk` and every `--risk-ids` filter look
  // them up globally. Two different packs may reuse an id — that is what the
  // pack stamp on results is for — but one pack may not.
  PackId.assertUnique(
    allRisks(taxonomy).map(r => r.id),
    "risk",
    scope
  );
  for (const risk of allRisks(taxonomy)) {
    if (risk.scenarioFlavors) {
      assertFlavorsSumToOne(risk.id, risk.scenarioFlavors);
    }
  }

  return taxonomy;
}

function fingerprint(taxonomy: RiskTaxonomy): string {
  return Hash.shortHash(stableJson(taxonomy));
}

//
// Exports.
//

export interface RiskTaxonomy {
  id: string;
  version: string;
  name?: string;
  categories: readonly RiskCategory[];
  motivations?: readonly Motivation[];
}

type RiskTaxonomySchema = v.GenericSchema<
  unknown,
  RiskTaxonomy,
  v.BaseIssue<unknown>
>;

export const RiskTaxonomy = {
  get io(): RiskTaxonomySchema {
    return io();
  },
  parse,
  fingerprint,
  label,
  allRisks,
};
