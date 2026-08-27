import {Behavior, BehaviorLevel} from "../packs/behaviorSet.js";
import {Packs} from "../packs/packs.js";

//
// Bridge between the pack vocabulary ("behavior") and the vocabulary the rest
// of the codebase and every persisted output still use ("mechanism"). Same
// concept, two names; see the naming note in `packs/behaviorSet.ts`.
//

//
// API.
//

function listAll(): readonly Mechanism[] {
  return Packs.current().behaviors.behaviors;
}

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

export type MechanismLevel = BehaviorLevel;
export type Mechanism = Behavior;

export const Mechanism = {
  io: Behavior.io,
  codeOf: Behavior.codeOf,
  hasPrecondition: Behavior.hasPrecondition,
  listAll,
  find,
};
