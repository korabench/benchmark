import {ModelSpec} from "@korabench/benchmark";
import {Profile, ProfileRoles} from "../profile.js";

//
// Test fixtures.
//

export function makeSpec(
  name: string,
  overrides: Partial<ModelSpec> = {}
): ModelSpec {
  return {name, model: `provider/${name}`, ...overrides};
}

export function makeRoles(overrides: Partial<ProfileRoles> = {}): ProfileRoles {
  return {
    seeds: [makeSpec("seed-a")],
    expansion: [makeSpec("expand-a")],
    expansionUser: [makeSpec("user-a")],
    user: makeSpec("user-a"),
    judges: [makeSpec("judge-a")],
    ...overrides,
  };
}

/** A structurally valid profile whose `hash` is correct. */
export function makeProfile(
  overrides: Partial<Omit<Profile, "hash">> = {}
): Profile {
  const base = {
    id: "test",
    version: "1",
    roles: makeRoles(),
    ...overrides,
  };
  return {...base, hash: Profile.computeHash(base)};
}
