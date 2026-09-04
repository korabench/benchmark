import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {describe, expect, it} from "vitest";
import {listProfileNames, loadProfile, profilesDir} from "../loadProfile.js";
import {makeProfile} from "./fixtures.js";

const dir = mkdtempSync(path.join(tmpdir(), "kora-profiles-"));

function writeJson(name: string, value: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

writeJson("kora.json", makeProfile({id: "kora"}));
writeJson("other.json", makeProfile({id: "other"}));
writeJson("scratch.local.json", {
  ...makeProfile({id: "scratch"}),
  hash: "nope",
});
writeJson("stale.json", {...makeProfile({id: "stale"}), hash: "nope"});

describe("profilesDir", () => {
  it("sits next to models.json", () => {
    expect(profilesDir("/repo/models.json")).toBe("/repo/profiles");
  });
});

describe("listProfileNames", () => {
  it("lists committed profiles and hides local ones", () => {
    expect(listProfileNames(dir)).toEqual(["kora", "other", "stale"]);
  });

  it("is empty for a missing directory", () => {
    expect(listProfileNames(path.join(dir, "absent"))).toEqual([]);
  });
});

describe("loadProfile", () => {
  it("resolves a committed profile by name", () => {
    const loaded = loadProfile("kora", dir);
    expect(loaded.profile.id).toBe("kora");
    expect(loaded.local).toBe(false);
    expect(loaded.path).toBe(path.join(dir, "kora.json"));
  });

  it("resolves a local profile by name and skips the hash check", () => {
    const loaded = loadProfile("scratch.local", dir);
    expect(loaded.profile.id).toBe("scratch");
    expect(loaded.local).toBe(true);
  });

  it("verifies the hash of a committed profile", () => {
    expect(() => loadProfile("stale", dir)).toThrow(/declares hash "nope"/);
  });

  it("can skip verification explicitly", () => {
    expect(loadProfile("stale", dir, {verifyHash: false}).profile.hash).toBe(
      "nope"
    );
  });

  it("lists known profiles for an unknown name", () => {
    expect(() => loadProfile("nope", dir)).toThrow(
      /Unknown profile "nope". Known profiles: kora, other, stale/
    );
  });

  it("loads a profile from a path", () => {
    const nested = path.join(dir, "elsewhere");
    mkdirSync(nested, {recursive: true});
    const filePath = path.join(nested, "custom.json");
    writeFileSync(filePath, JSON.stringify(makeProfile({id: "custom"})));
    expect(loadProfile(filePath, dir).profile.id).toBe("custom");
  });

  it("reports the path when a file is missing", () => {
    expect(() => loadProfile(path.join(dir, "absent.json"), dir)).toThrow(
      /Could not read profile from .*absent\.json/
    );
  });
});
