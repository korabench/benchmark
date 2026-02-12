import {memoize} from "@korabench/core";
import * as v from "valibot";
import motivations from "../../data/motivations.json" with {type: "json"};

//
// Runtime model.
//

const VMotivation = v.object({
  name: v.string(),
  description: v.string(),
});

//
// API.
//

const listAll = memoize(() => {
  const type = v.pipe(v.array(VMotivation), v.readonly());
  return v.parse(type, motivations);
});

//
// Exports.
//

export interface Motivation extends v.InferOutput<typeof VMotivation> {}
export const Motivation = {
  io: VMotivation,
  listAll,
};
