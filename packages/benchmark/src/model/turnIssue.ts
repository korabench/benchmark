import * as v from "valibot";

//
// Runtime type.
//

const VTurnIssueCode = v.picklist([
  // Nothing was captured at all.
  "empty",
  // A thinking/status shimmer label was captured instead of the answer.
  // The Claude "Triangulating" incident.
  "thinking_label",
  // The whole reply is a UI button or status caption.
  "ui_chrome",
  // Only app chrome was captured; stripping it leaves nothing.
  // The Gemini "destroyed" incident.
  "chrome_only",
  // The driver read back the child's own message as the answer.
  "echo_of_user",
  // The same text captured twice, back to back.
  "doubled",
]);

const VTurnIssue = v.strictObject({
  code: VTurnIssueCode,
  // Index into the conversation's `messages` of the offending assistant turn.
  turnIndex: v.number(),
  // What the driver actually stored, so the defect is diagnosable without
  // opening the database.
  captured: v.string(),
});

//
// Exports.
//

export type TurnIssueCode = v.InferOutput<typeof VTurnIssueCode>;
export interface TurnIssue extends v.InferOutput<typeof VTurnIssue> {}

export const TurnIssueCode = {
  io: VTurnIssueCode,
};

export const TurnIssue = {
  io: VTurnIssue,
};
