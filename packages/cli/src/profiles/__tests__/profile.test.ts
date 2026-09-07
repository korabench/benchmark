import {describe, expect, it} from "vitest";
import {ODD_JUDGES_MESSAGE, Profile, Role} from "../profile.js";
import {makeProfile, makeRoles, makeSpec} from "./fixtures.js";

describe("Profile.parse", () => {
  it("accepts a valid profile with a matching hash", () => {
    const profile = makeProfile();
    expect(Profile.parse(profile, {verifyHash: true})).toEqual(profile);
  });

  it("rejects an even number of judges", () => {
    const profile = makeProfile({
      roles: makeRoles({judges: [makeSpec("j1"), makeSpec("j2")]}),
    });
    expect(() => Profile.parse(profile, {verifyHash: true})).toThrow(
      ODD_JUDGES_MESSAGE
    );
  });

  it("rejects a duplicate model name within a role", () => {
    const profile = makeProfile({
      roles: makeRoles({seeds: [makeSpec("same"), makeSpec("same")]}),
    });
    expect(() => Profile.parse(profile, {verifyHash: true})).toThrow(
      /role "seeds" lists the same model name more than once: same/
    );
  });

  it("rejects unknown keys so a typo cannot silently drop a role", () => {
    const profile = {...makeProfile(), roles: {...makeRoles(), judge: []}};
    expect(() => Profile.parse(profile, {verifyHash: true})).toThrow();
  });

  it("reports the expected hash on mismatch", () => {
    const profile = {...makeProfile(), hash: "stale"};
    const expected = Profile.computeHash(profile);
    expect(() => Profile.parse(profile, {verifyHash: true})).toThrow(
      new RegExp(
        `declares hash "stale" but its content hashes to "${expected}"`
      )
    );
  });

  it("accepts a stale hash when verification is off", () => {
    const profile = {...makeProfile(), hash: "stale"};
    expect(Profile.parse(profile, {verifyHash: false}).hash).toBe("stale");
  });
});

describe("Profile.computeHash", () => {
  it("ignores the hash field and key order", () => {
    const profile = makeProfile();
    const reordered = {
      roles: profile.roles,
      version: profile.version,
      id: profile.id,
    };
    expect(Profile.computeHash(reordered)).toBe(profile.hash);
  });

  it("changes when any role config changes", () => {
    const a = makeProfile();
    const b = makeProfile({
      roles: makeRoles({user: makeSpec("user-a", {temperature: 0.1})}),
    });
    expect(a.hash).not.toBe(b.hash);
  });

  it("changes when the version changes", () => {
    expect(makeProfile({version: "1"}).hash).not.toBe(
      makeProfile({version: "2"}).hash
    );
  });
});

describe("Profile.effectiveRoles", () => {
  it("falls back to user for continueUser", () => {
    const roles = makeRoles();
    expect(Profile.effectiveRoles(roles).continueUser).toEqual(roles.user);
  });

  it("keeps an explicit continueUser", () => {
    const roles = makeRoles({continueUser: makeSpec("cont")});
    expect(Profile.effectiveRoles(roles).continueUser.name).toBe("cont");
  });
});

describe("Role.specsOf", () => {
  it("normalizes single and chain roles to arrays", () => {
    const roles = makeRoles();
    expect(Role.specsOf(roles, "user")).toEqual([roles.user]);
    expect(Role.specsOf(roles, "seeds")).toEqual(roles.seeds);
    expect(Role.specsOf(roles, "continueUser")).toEqual([]);
  });
});
