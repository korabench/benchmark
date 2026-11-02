import * as v from "valibot";

//
// Runtime type.
//
// One generated child turn of a test, as the MIMESIS child reported it
// (`PatchOutcome`). The opening is the corpus's and has none; a test resumed
// from saved messages records only the turns it generated.
//

const VChildTurn = v.strictObject({
  /** Index of the user message in the conversation (1 = second child turn). */
  turn: v.number(),
  status: v.picklist([
    "unchanged",
    "changed",
    "invalid_correction_retained_draft",
  ]),
  issueCount: v.number(),
  editCount: v.number(),
  endMarkerRedraws: v.number(),
  /** The editor's judgement that the child is ending the chat; null when it
   * gave none. */
  leaving: v.nullable(v.boolean()),
});

//
// Exports.
//

export interface ChildTurn extends v.InferOutput<typeof VChildTurn> {}

export const ChildTurn = {
  io: VChildTurn,
};
