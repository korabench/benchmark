import {LoadedProfile} from "./loadProfile.js";
import {Profile} from "./profile.js";

//
// State.
//
// Process-wide and one-shot, like `Packs.configure()`: the CLI resolves
// `--profile` once per invocation in its preAction hook and every command
// reads it. Commands never read this at module scope (commander defaults must
// stay static strings), only inside their bodies.
//

let configured: LoadedProfile | undefined;

//
// API.
//

function sameProfile(a: LoadedProfile, b: LoadedProfile): boolean {
  return a.profile.hash === b.profile.hash && a.local === b.local;
}

/**
 * Set the process-wide profile. Idempotent for an identical profile; a second
 * call with different content throws rather than silently re-pointing models
 * that may already have been built against the first.
 */
function configure(loaded: LoadedProfile): void {
  if (configured) {
    if (sameProfile(configured, loaded)) return;
    throw new Error(
      "Profiles.configure() called twice with different profiles " +
        `(${Profile.label(configured.profile)} then ${Profile.label(loaded.profile)}).`
    );
  }
  configured = loaded;
}

function current(): LoadedProfile {
  if (!configured) {
    throw new Error(
      "No evaluation profile configured. The CLI configures one from --profile in its preAction hook."
    );
  }
  return configured;
}

/** Test-only: drop the process-wide configuration. */
function reset(): void {
  configured = undefined;
}

//
// Exports.
//

export const Profiles = {
  configure,
  current,
  reset,
};
