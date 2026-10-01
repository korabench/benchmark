import * as v from "valibot";
import bundledData from "../../data/motivationUseLikelihood.json" with {type: "json"};
import {SeedUse} from "./scenarioSeed.js";

//
// Runtime model.
//
// How likely a child with a given motivation is to have opened the assistant
// for a given use, on a 0-5 scale: 0 is a logically incompatible pairing, 5 a
// typical one. Keyed by motivation name, then by use.
//
// It only shapes which motivation is paired with which use during seed
// allocation (see `allocation/pairUsesWithMotivations.ts`): how many seeds each
// motivation and each use receive is unaffected. It is seed-generation input,
// not part of the pack, so editing it does not change the pack stamp on results.
//

const VScore = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(5));

const VMotivationUseLikelihood = v.record(
  v.string(),
  v.partial(v.object(v.entriesFromList(SeedUse.list, VScore)))
);

//
// API.
//

/** Score assumed for a pairing the matrix does not list. */
const NEUTRAL_SCORE = 3;

let cached: MotivationUseLikelihood | undefined;

function bundled(): MotivationUseLikelihood {
  return (cached ??= v.parse(VMotivationUseLikelihood, bundledData));
}

function score(
  matrix: MotivationUseLikelihood,
  motivationName: string,
  use: SeedUse
): number {
  return matrix[motivationName]?.[use] ?? NEUTRAL_SCORE;
}

//
// Exports.
//

export type MotivationUseLikelihood = v.InferOutput<
  typeof VMotivationUseLikelihood
>;

export const MotivationUseLikelihood = {
  io: VMotivationUseLikelihood,
  neutralScore: NEUTRAL_SCORE,
  bundled,
  score,
};
