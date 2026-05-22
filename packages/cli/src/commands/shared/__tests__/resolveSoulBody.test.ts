import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {resolveSoulBody} from "../resolveSoulBody.js";

describe("resolveSoulBody", () => {
  let tmpDir: string;
  let dataPath: string;
  let envPath: string;
  let seedPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "kora-soul-test-"));
    dataPath = path.join(tmpDir, "data");
    mkdirSync(path.join(dataPath, "souls"), {recursive: true});
    envPath = path.join(tmpDir, "soul-from-env.md");
    seedPath = path.join(dataPath, "souls", "seed.md");
    delete process.env.SOUL_MD_PATH;
  });

  afterEach(() => {
    delete process.env.SOUL_MD_PATH;
    rmSync(tmpDir, {recursive: true, force: true});
  });

  it("returns the SOUL_MD_PATH file contents when set and readable", () => {
    const body = "# Soul from env\nYou are SOULFuzz.";
    writeFileSync(envPath, body);
    process.env.SOUL_MD_PATH = envPath;

    expect(resolveSoulBody(dataPath)).toBe(body);
  });

  it("throws naming SOUL_MD_PATH when env path is unreadable", () => {
    process.env.SOUL_MD_PATH = path.join(tmpDir, "does-not-exist.md");

    expect(() => resolveSoulBody(dataPath)).toThrow(/SOUL_MD_PATH/);
    expect(() => resolveSoulBody(dataPath)).toThrow(/does-not-exist\.md/);
  });

  it("falls back to <dataPath>/souls/seed.md when SOUL_MD_PATH is unset", () => {
    const body = "# Soul from seed\nYou are SOULFuzz.";
    writeFileSync(seedPath, body);

    expect(resolveSoulBody(dataPath)).toBe(body);
  });

  it("throws naming SOUL_MD_PATH when env unset and seed missing", () => {
    expect(() => resolveSoulBody(dataPath)).toThrow(/SOUL_MD_PATH/);
    expect(() => resolveSoulBody(dataPath)).toThrow(/seed\.md/);
  });

  it("throws when env-resolved body is empty", () => {
    writeFileSync(envPath, "   \n\t  \n");
    process.env.SOUL_MD_PATH = envPath;

    expect(() => resolveSoulBody(dataPath)).toThrow(/empty/);
    expect(() => resolveSoulBody(dataPath)).toThrow(/soul-from-env\.md/);
  });

  it("throws when seed-resolved body is empty", () => {
    writeFileSync(seedPath, "");

    expect(() => resolveSoulBody(dataPath)).toThrow(/empty/);
    expect(() => resolveSoulBody(dataPath)).toThrow(/seed\.md/);
  });
});
