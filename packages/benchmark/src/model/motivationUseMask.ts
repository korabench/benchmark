import * as v from "valibot";
import bundledData from "../../data/motivationUseMask.json" with {type: "json"};
import {SeedUse} from "./scenarioSeed.js";

//
// Runtime model.
//
// Whether a child with a given motivation can have opened the assistant for a
// given use: `true` when the pairing is allowed, `false` when it never occurs.
// Keyed by motivation name, then by use.
//
// It only shapes which motivation is paired with which use during seed
// allocation (see `allocation/pairUsesWithMotivations.ts`): how many seeds each
// motivation and each use receive is unaffected. It is seed-generation input,
// not part of the pack, so editing it does not change the pack stamp on results.
//

const VMotivationUseMask = v.record(
  v.string(),
  v.partial(v.object(v.entriesFromList(SeedUse.list, v.boolean())))
);

//
// API.
//

let cached: MotivationUseMask | undefined;

function bundled(): MotivationUseMask {
  return (cached ??= v.parse(VMotivationUseMask, bundledData));
}

/** A pairing the mask does not list is allowed. */
function allowed(
  mask: MotivationUseMask,
  motivationName: string,
  use: SeedUse
): boolean {
  return mask[motivationName]?.[use] ?? true;
}

//
// Exports.
//

export type MotivationUseMask = v.InferOutput<typeof VMotivationUseMask>;

export const MotivationUseMask = {
  io: VMotivationUseMask,
  bundled,
  allowed,
};
