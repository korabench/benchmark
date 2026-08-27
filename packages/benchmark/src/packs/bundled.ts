import behaviors from "../../data/behaviors.json" with {type: "json"};
import motivations from "../../data/motivations.json" with {type: "json"};
import risks from "../../data/risks.json" with {type: "json"};
import {BehaviorSet} from "./behaviorSet.js";
import type {ActivePacks} from "./packs.js";
import {RiskTaxonomy} from "./riskTaxonomy.js";

//
// Bundled pack.
//
// The default KORA taxonomy + behavior set, shipped with the package so a fresh
// clone runs with no configuration. `risks.json` and `motivations.json` are bare
// arrays kept in their historical shape; the `RiskTaxonomy` envelope is applied
// here rather than in the data file.
//
// Bump these versions whenever the underlying data changes meaningfully — they
// are stamped into every run's results.
//

const TAXONOMY_ID = "kora";
const TAXONOMY_VERSION = "2";

//
// API.
//
// Deliberately lazy. `packs.ts` imports this module and `riskTaxonomy.ts`
// imports `model/riskCategory.ts`, which imports `packs.ts` back — parsing at
// module scope would run inside that import cycle. Building on first use also
// means a caller that always supplies its own pack never pays for this one.
//

let cached: ActivePacks | undefined;

export function bundledPacks(): ActivePacks {
  return (cached ??= {
    taxonomy: RiskTaxonomy.parse({
      id: TAXONOMY_ID,
      version: TAXONOMY_VERSION,
      name: "KORA risk taxonomy",
      categories: risks,
      motivations,
    }),
    behaviors: BehaviorSet.parse(behaviors),
  });
}
