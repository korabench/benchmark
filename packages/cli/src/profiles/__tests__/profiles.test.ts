import {afterEach, describe, expect, it} from "vitest";
import {LoadedProfile} from "../loadProfile.js";
import {Profiles} from "../profiles.js";
import {makeProfile} from "./fixtures.js";

afterEach(() => Profiles.reset());

function loaded(id: string, local = false): LoadedProfile {
  return {profile: makeProfile({id}), local, path: `/x/${id}.json`};
}

describe("Profiles", () => {
  it("throws before configuration", () => {
    expect(() => Profiles.current()).toThrow(
      /No evaluation profile configured/
    );
  });

  it("returns the configured profile", () => {
    const a = loaded("a");
    Profiles.configure(a);
    expect(Profiles.current()).toBe(a);
  });

  it("is idempotent for identical content", () => {
    Profiles.configure(loaded("a"));
    expect(() => Profiles.configure(loaded("a"))).not.toThrow();
  });

  it("refuses a second, different profile", () => {
    Profiles.configure(loaded("a"));
    expect(() => Profiles.configure(loaded("b"))).toThrow(
      /called twice with different profiles \(a@1 then b@1\)/
    );
  });

  it("treats local and committed copies as different", () => {
    Profiles.configure(loaded("a"));
    expect(() => Profiles.configure(loaded("a", true))).toThrow();
  });
});
