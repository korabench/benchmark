import {memoize} from "@korabench/core";
import * as v from "valibot";
import {mechanisms} from "../../data/mechanisms.js";

//
// Runtime model.
//

const VMechanismLevel = v.picklist(["conversation"]);

const VMechanism = v.object({
  id: v.string(),
  excelId: v.string(),
  name: v.string(),
  level: VMechanismLevel,
  criterionPrompt: v.string(),
});

//
// API.
//

const listAll = memoize(() => {
  const type = v.pipe(v.array(VMechanism), v.readonly());
  return v.parse(type, mechanisms);
});

function find(id: string): Mechanism {
  const result = listAll().find(m => m.id === id);
  if (!result) {
    throw new Error(`Mechanism not found: ${id}`);
  }
  return result;
}

//
// Exports.
//

export type MechanismLevel = v.InferOutput<typeof VMechanismLevel>;
export interface Mechanism extends v.InferOutput<typeof VMechanism> {}

export const Mechanism = {
  io: VMechanism,
  listAll,
  find,
};
