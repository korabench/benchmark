import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  describeProfileRef,
  resolveEffectiveProfile,
} from "../effectiveProfile.js";
import {ODD_JUDGES_MESSAGE} from "../profile.js";
import {Profiles} from "../profiles.js";
import {makeProfile, makeRoles, makeSpec} from "./fixtures.js";

const dir = mkdtempSync(path.join(tmpdir(), "kora-effective-"));
const modelsJsonPath = path.join(dir, "models.json");
writeFileSync(
  modelsJsonPath,
  JSON.stringify({
    "judge-x": {model: "openai/judge-x", maxTokens: 100},
    "judge-y": {model: "openai/judge-y"},
    "user-x": {model: "deepseek/user-x", temperature: 0.2},
  })
);

const profile = makeProfile({id: "kora"});

beforeEach(() => {
  Profiles.configure({profile, local: false, path: "/x/kora.json"});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  Profiles.reset();
  vi.restoreAllMocks();
});

describe("resolveEffectiveProfile", () => {
  it("returns the profile's own hash and roles without overrides", () => {
    const effective = resolveEffectiveProfile(modelsJsonPath);
    expect(effective.ref).toEqual({
      id: "kora",
      version: "1",
      hash: profile.hash,
    });
    expect(effective.roles.continueUser).toEqual(profile.roles.user);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("resolves an override through models.json and re-hashes", () => {
    const effective = resolveEffectiveProfile(modelsJsonPath, {
      judges: ["judge-x"],
    });
    expect(effective.roles.judges).toEqual([
      {name: "judge-x", model: "openai/judge-x", maxTokens: 100},
    ]);
    expect(effective.ref.overrides).toEqual(["judges"]);
    expect(effective.ref.hash).not.toBe(profile.hash);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /WARNING: command-line judges overrides profile kora@1 \(judge-a -> judge-x\)/
      )
    );
  });

  it("hashes identical overrides identically", () => {
    const a = resolveEffectiveProfile(modelsJsonPath, {judges: ["judge-x"]});
    const b = resolveEffectiveProfile(modelsJsonPath, {judges: ["judge-x"]});
    expect(a.ref.hash).toBe(b.ref.hash);
  });

  it("marks local profiles", () => {
    Profiles.reset();
    Profiles.configure({profile, local: true, path: "/x/kora.local.json"});
    expect(resolveEffectiveProfile(modelsJsonPath).ref.local).toBe(true);
  });

  it("rejects an even number of judge overrides", () => {
    expect(() =>
      resolveEffectiveProfile(modelsJsonPath, {judges: ["judge-x", "judge-y"]})
    ).toThrow(ODD_JUDGES_MESSAGE);
  });

  it("rejects several models for a single-model role", () => {
    expect(() =>
      resolveEffectiveProfile(modelsJsonPath, {user: ["user-x", "judge-x"]})
    ).toThrow(/Role "user" takes exactly one model, got 2/);
  });

  it("rejects an unknown slug", () => {
    expect(() =>
      resolveEffectiveProfile(modelsJsonPath, {user: ["nope"]})
    ).toThrow(/Unknown model "nope"/);
  });

  it("ignores empty override lists", () => {
    const effective = resolveEffectiveProfile(modelsJsonPath, {judges: []});
    expect(effective.ref.hash).toBe(profile.hash);
  });
});

describe("describeProfileRef", () => {
  it("shows markers only when present", () => {
    expect(describeProfileRef({id: "kora", version: "1", hash: "h"})).toBe(
      "kora@1 (h)"
    );
    expect(
      describeProfileRef({
        id: "kora",
        version: "1",
        hash: "h",
        local: true,
        overrides: ["judges", "user"],
      })
    ).toBe("kora@1 (h) [local; overrides: judges,user]");
  });
});

describe("fixtures", () => {
  it("build a valid roles object", () => {
    expect(makeRoles({user: makeSpec("u")}).user.name).toBe("u");
  });
});
