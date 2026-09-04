import {Packs, Prompts, RunStamp} from "@korabench/benchmark";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {makeRoles} from "../../profiles/__tests__/fixtures.js";
import {EffectiveProfile} from "../../profiles/effectiveProfile.js";
import {Profile} from "../../profiles/profile.js";
import {buildRunStamp, resolveTargetRef} from "../buildRunStamp.js";

const dir = mkdtempSync(path.join(tmpdir(), "kora-stamp-"));
const modelsJsonPath = path.join(dir, "models.json");
writeFileSync(
  modelsJsonPath,
  JSON.stringify({"gpt-x": {model: "openai/gpt-x", maxTokens: 10}})
);
const inputPath = path.join(dir, "input.jsonl");
writeFileSync(inputPath, "{}\n");

const effective: EffectiveProfile = {
  ref: {id: "test", version: "1", hash: "h"},
  roles: Profile.effectiveRoles(makeRoles()),
};

describe("resolveTargetRef", () => {
  it("resolves gateway slugs to a spec", () => {
    expect(resolveTargetRef(modelsJsonPath, "gpt-x")).toEqual({
      name: "gpt-x",
      model: "openai/gpt-x",
      maxTokens: 10,
    });
  });

  it.each([
    ["kora-app-foo", "web-runner"],
    ["kora-app-foo-android", "native-runner"],
    ["kora-app-foo-ios", "native-runner"],
    ["custom-thing", "custom"],
  ])("maps %s to a %s reference", (slug, kind) => {
    expect(resolveTargetRef(modelsJsonPath, slug)).toEqual({kind, slug});
  });
});

describe("buildRunStamp", () => {
  it("records profile, roles, prompts, packs, code and input", async () => {
    const stamp = await buildRunStamp({
      effective,
      modelsJsonPath,
      target: "kora-app-foo",
      inputPath,
    });
    expect(v.parse(RunStamp.io, stamp)).toEqual(stamp);
    expect(stamp.profile).toEqual(effective.ref);
    expect(stamp.models.user).toEqual(effective.roles.user);
    expect(stamp.models.target).toEqual({
      kind: "web-runner",
      slug: "kora-app-foo",
    });
    expect(stamp.prompts).toEqual(Prompts.fingerprint());
    expect(stamp.packs).toEqual(Packs.fingerprint());
    expect(stamp.code.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(stamp.input).toEqual({
      path: inputPath,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("omits target and input when not given", async () => {
    const stamp = await buildRunStamp({effective, modelsJsonPath});
    expect("target" in stamp.models).toBe(false);
    expect("input" in stamp).toBe(false);
  });
});
