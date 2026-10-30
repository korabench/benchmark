import * as v from "valibot";

//
// Runtime type.
//
// The reasoning the tested model returned alongside one of its answers,
// verbatim: a provider-written summary for OpenAI, Anthropic and Google, the
// raw trace for open-weight models. Recorded only: no judge reads it. A turn
// is recorded only when the model returned reasoning text or a reasoning token
// count; a test resumed from saved messages records only the turns it
// generated.
//

const VAssistantTurn = v.strictObject({
  /** Conversation turn of the answer (0 = reply to the opening), i.e. the
   * assistant message at index `2 * turn + 1`. */
  turn: v.number(),
  /** Reasoning text as the provider returned it; null when it returned none. */
  reasoning: v.nullable(v.string()),
  /** Reasoning tokens billed for the answer; null when not reported. */
  reasoningTokens: v.nullable(v.number()),
});

//
// API.
//

function mergeResumed(
  earlier: readonly AssistantTurn[] | undefined,
  later: readonly AssistantTurn[] | undefined
): AssistantTurn[] | undefined {
  const laterTurns = new Set(later?.map(t => t.turn));
  const merged = [
    ...(earlier ?? []).filter(t => !laterTurns.has(t.turn)),
    ...(later ?? []),
  ].sort((a, b) => a.turn - b.turn);
  return merged.length > 0 ? merged : undefined;
}

//
// Exports.
//

export interface AssistantTurn extends v.InferOutput<typeof VAssistantTurn> {}

export const AssistantTurn = {
  io: VAssistantTurn,
  /** Joins the turns of a resumed test with those recorded before it; the
   * later record of a turn wins. */
  mergeResumed,
};
