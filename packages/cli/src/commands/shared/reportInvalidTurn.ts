import {InvalidTurnError} from "@korabench/benchmark";

const MAX_CAPTURED = 400;

/**
 * Print what a driver actually captured when a turn is rejected.
 *
 * A run that quietly discards scenarios looks the same as a run hitting rate
 * limits, so the captured text goes on screen: seeing "Triangulating" once is
 * usually enough to identify the driver bug behind it. Output is plain and
 * greppable — these runs are watched through a log.
 */
export function reportInvalidTurn(label: string, error: unknown): boolean {
  if (!(error instanceof InvalidTurnError)) return false;

  const {code, turnIndex, captured} = error.issue;
  const shown =
    captured.length > MAX_CAPTURED
      ? `${captured.slice(0, MAX_CAPTURED)}… (${captured.length} chars)`
      : captured;

  console.error(
    `\nInvalid capture [${code}] at turn ${turnIndex} for ${label}` +
      `\n  captured: ${JSON.stringify(shown)}` +
      `\n  discarded without judging; re-run the scenario to replace it.`
  );
  return true;
}
