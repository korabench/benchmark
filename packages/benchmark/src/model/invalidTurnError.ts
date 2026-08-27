import {CustomError} from "@korabench/core";
import {TurnIssue} from "./turnIssue.js";

/**
 * Thrown when a driver captured something that is not an answer.
 *
 * The conversation is abandoned rather than judged: a corrupt transcript that
 * reaches the judge becomes a real-looking score, which is worse than no score
 * at all. Callers re-run the scenario.
 */
export class InvalidTurnError extends CustomError {
  constructor(public readonly issue: TurnIssue) {
    super(
      `Invalid capture: ${issue.code} at turn ${issue.turnIndex} ` +
        `(captured ${JSON.stringify(issue.captured.slice(0, 120))})`
    );
  }
}
