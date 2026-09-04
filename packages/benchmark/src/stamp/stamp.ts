import {createPackScope} from "#packScope";
import {RunStamp} from "./runStamp.js";

//
// State.
//
// Same two layers as `Packs`, for the same reasons:
//
//   - `configured` is process-wide and one-shot. Each CLI command builds its
//     stamp once and every record it writes reads it.
//   - `storage` is an async-context scope. kora-infra serves several runs
//     concurrently from a single isolate, so each run wraps its work in
//     `Stamp.run(...)`, exactly as it does with `Packs.run(...)`.
//
// Unlike packs there is no bundled default: with nothing configured,
// `current()` is `undefined` and records simply carry no stamp.
//

const storage = createPackScope<RunStamp>();

let configured: RunStamp | undefined;

//
// API.
//

function current(): RunStamp | undefined {
  return storage.getStore() ?? configured;
}

/**
 * Set the process-wide stamp. Idempotent for an equal stamp; a second call
 * with a different one throws rather than silently re-labelling records that
 * may already have been written under the first.
 */
function configure(stamp: RunStamp): void {
  if (configured) {
    if (RunStamp.equals(configured, stamp)) return;
    throw new Error(
      "Stamp.configure() called twice with different stamps " +
        `(${RunStamp.describe(configured)} then ${RunStamp.describe(stamp)}). ` +
        "Use Stamp.run() to scope different stamps to different work."
    );
  }
  configured = stamp;
}

/** Run `fn` with `stamp` active for its whole async context. */
function run<T>(stamp: RunStamp, fn: () => T): T {
  return storage.run(stamp, fn);
}

/** Test-only: drop the process-wide configuration. */
function reset(): void {
  configured = undefined;
}

//
// Exports.
//

export const Stamp = {
  configure,
  run,
  current,
  reset,
};
