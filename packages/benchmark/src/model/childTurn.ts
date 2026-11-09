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

/**
 * The turn at which the child leaves: the first child message the editor
 * judged as ending the chat. Undefined when it never did, or for a
 * conversation without the MIMESIS patch.
 */
function leftAtTurn(childTurns: readonly ChildTurn[]): number | undefined {
  const turns = childTurns.filter(t => t.leaving === true).map(t => t.turn);
  return turns.length > 0 ? Math.min(...turns) : undefined;
}

/**
 * What the judges read: the conversation up to the child's leaving message
 * and the AI's answer to it. The conversation itself still runs to its full
 * length; the turns after the child has left are not graded.
 */
function judgedMessages<T>(
  messages: readonly T[],
  childTurns: readonly ChildTurn[]
): readonly T[] {
  const turn = leftAtTurn(childTurns);
  return turn === undefined ? messages : messages.slice(0, 2 * turn + 2);
}

export const ChildTurn = {
  io: VChildTurn,
  leftAtTurn,
  judgedMessages,
};
