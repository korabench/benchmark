import {readFileSync} from "node:fs";
import * as path from "node:path";
import {fileURLToPath} from "node:url";
import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {resolveModelConfig} from "../../models/modelConfig.js";
import {listProfileNames} from "../loadProfile.js";
import {Profile, Role} from "../profile.js";

//
// CI guard for the committed profiles under `<repo>/profiles/`.
//
// A profile's hash is what results are keyed on. Editing a profile without
// bumping its version and hash would make new runs look comparable to old
// ones, so this test refuses that state and prints the value to paste.
//

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const profilesDir = path.join(repoRoot, "profiles");
const modelsJsonPath = path.join(repoRoot, "models.json");

function readProfile(name: string): Profile {
  const raw = JSON.parse(
    readFileSync(path.join(profilesDir, `${name}.json`), "utf-8")
  );
  return Profile.parse(raw, {verifyHash: false});
}

const names = listProfileNames(profilesDir);
const profiles = names.map(name => [name, readProfile(name)] as const);

describe("committed profiles", () => {
  it("include the bundled default", () => {
    expect(names).toContain("kora");
  });

  it.each(profiles)("%s carries its own content hash", (name, profile) => {
    const expected = Profile.computeHash(profile);
    expect(
      profile.hash,
      `profiles/${name}.json changed: bump "version" and set "hash" to "${expected}"`
    ).toBe(expected);
  });

  it("use unique ids and versions", () => {
    const labels = profiles.map(([, p]) => Profile.label(p));
    expect(R.unique(labels)).toEqual(labels);
    const ids = profiles.map(([, p]) => p.id);
    expect(R.unique(ids)).toEqual(ids);
  });

  it("name each profile after its file", () => {
    profiles.forEach(([name, profile]) => expect(profile.id).toBe(name));
  });
});

describe("bundled profile kora", () => {
  // Every role of the default profile must match the models.json entry of
  // the same name: the profile replaced hardcoded CLI defaults that were
  // registry slugs, and result headers still print those names.
  const kora = readProfile("kora");

  it.each(Role.list)("role %s matches the registry entry of its name", role => {
    Role.specsOf(kora.roles, role).forEach(spec => {
      expect(
        R.omit(spec, ["name"]),
        `profiles/kora.json role ${role}: "${spec.name}" differs from models.json`
      ).toEqual(resolveModelConfig(modelsJsonPath, spec.name));
    });
  });
});
