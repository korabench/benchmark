import {ModelSpec} from "../../model/modelSpec.js";
import {Packs} from "../../packs/packs.js";
import {RunStamp} from "../runStamp.js";

//
// Test fixtures.
//

export function makeSpec(
  name: string,
  overrides: Partial<ModelSpec> = {}
): ModelSpec {
  return {name, model: `provider/${name}`, ...overrides};
}

/** A complete stamp under the bundled packs. Override any field. */
export function makeStamp(overrides: Partial<RunStamp> = {}): RunStamp {
  return {
    profile: {id: "test", version: "1", hash: "profile-hash"},
    models: {
      seeds: [makeSpec("seed")],
      expansion: [makeSpec("expand")],
      expansionUser: [makeSpec("user")],
      user: makeSpec("user"),
      judges: [makeSpec("judge")],
      continueUser: makeSpec("user"),
    },
    prompts: {version: "1", hash: "prompts-hash"},
    code: {version: "1.0.0", commit: "abc", dirty: false},
    packs: Packs.fingerprint(),
    ...overrides,
  };
}
