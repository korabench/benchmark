import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {makeStamp} from "../../../stamp/__tests__/fixtures.js";
import {assertResumable, hasCachedFiles, STAMP_FILE} from "../cacheStamp.js";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "kora-cache-"));
}

afterEach(() => vi.restoreAllMocks());

describe("assertResumable", () => {
  it("writes the stamp into a fresh directory", async () => {
    const dir = freshDir();
    const stamp = makeStamp();
    await assertResumable(dir, stamp);
    expect(
      JSON.parse(readFileSync(path.join(dir, STAMP_FILE), "utf-8"))
    ).toEqual(JSON.parse(JSON.stringify(stamp)));
  });

  it("resumes under an equal stamp", async () => {
    const dir = freshDir();
    await assertResumable(dir, makeStamp());
    await expect(
      assertResumable(dir, makeStamp({code: {version: "other"}}))
    ).resolves.toBeUndefined();
  });

  it("refuses a different configuration and names both", async () => {
    const dir = freshDir();
    await assertResumable(dir, makeStamp());
    await expect(
      assertResumable(
        dir,
        makeStamp({profile: {id: "test", version: "2", hash: "other"}})
      )
    ).rejects.toThrow(
      /Refusing to resume .*\n\s+cached:\s+profile test@1 \(profile-hash\).*\n\s+current: profile test@2 \(other\)/
    );
  });

  it("warns and proceeds for a legacy directory without a stamp", async () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, "abc.json"), "{}");
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await assertResumable(dir, makeStamp());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/without a stamp/));
    expect(await hasCachedFiles(dir)).toBe(true);
  });
});

describe("hasCachedFiles", () => {
  it("ignores the stamp file", async () => {
    const dir = freshDir();
    await assertResumable(dir, makeStamp());
    expect(await hasCachedFiles(dir)).toBe(false);
  });

  it("is false for a missing directory", async () => {
    expect(await hasCachedFiles(path.join(freshDir(), "absent"))).toBe(false);
  });
});
