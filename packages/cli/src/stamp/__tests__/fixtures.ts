import {ModelSpec, Packs, RunStamp} from "@korabench/benchmark";

//
// Test fixtures.
//

function spec(name: string): ModelSpec {
  return {name, model: `provider/${name}`};
}

/** A complete stamp under the bundled packs. Override any field. */
export function makeStamp(overrides: Partial<RunStamp> = {}): RunStamp {
  return {
    profile: {id: "test", version: "1", hash: "profile-hash"},
    models: {
      seeds: [spec("seed")],
      expansion: [spec("expand")],
      expansionUser: [spec("user")],
      user: spec("user"),
      judges: [spec("judge")],
      continueUser: spec("user"),
    },
    prompts: {version: "1", hash: "prompts-hash"},
    code: {version: "1.0.0", commit: "abc", dirty: false},
    packs: Packs.fingerprint(),
    ...overrides,
  };
}
