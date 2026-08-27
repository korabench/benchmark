import * as v from "valibot";
import {Packs} from "../packs/packs.js";

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

/**
 * Motivations for the active taxonomy, falling back to the bundled set when a
 * custom taxonomy does not define its own.
 */
function listAll(): readonly Motivation[] {
  return (
    Packs.current().taxonomy.motivations ??
    Packs.bundled().taxonomy.motivations ??
    []
  );
}

//
// Exports.
//

export interface Motivation extends v.InferOutput<typeof VMotivation> {}

export const Motivation = {
  io: VMotivation,
  listAll,
};
