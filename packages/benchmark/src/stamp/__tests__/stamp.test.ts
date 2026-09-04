import {readdirSync, readFileSync} from "node:fs";
import * as v from "valibot";
import {afterEach, describe, expect, it} from "vitest";
import {RunStamp} from "../runStamp.js";
import {Stamp} from "../stamp.js";
import {makeSpec, makeStamp} from "./fixtures.js";

afterEach(() => Stamp.reset());

describe("RunStamp.hash", () => {
  it("is stable for equal content", () => {
    expect(RunStamp.hash(makeStamp())).toBe(RunStamp.hash(makeStamp()));
  });

  it.each([
    ["profile", {profile: {id: "test", version: "1", hash: "other"}}],
    ["prompts", {prompts: {version: "2", hash: "other"}}],
    [
      "packs",
      {
        packs: {
          taxonomy: {id: "x", version: "1", hash: "other"},
          behaviors: makeStamp().packs.behaviors,
        },
      },
    ],
  ] as const)("changes with %s", (_what, overrides) => {
    expect(RunStamp.hash(makeStamp(overrides))).not.toBe(
      RunStamp.hash(makeStamp())
    );
  });

  it.each([
    ["code", {code: {version: "9.9.9", commit: "zzz", dirty: true}}],
    ["input", {input: {path: "x.jsonl", sha256: "deadbeef"}}],
    ["target", {models: {...makeStamp().models, target: makeSpec("t")}}],
  ] as const)("ignores %s", (_what, overrides) => {
    expect(RunStamp.equals(makeStamp(overrides), makeStamp())).toBe(true);
  });
});

describe("RunStamp.io", () => {
  it("round-trips a full stamp with a runner target", () => {
    const stamp = makeStamp({
      profile: {
        id: "kora",
        version: "1",
        hash: "h",
        local: true,
        overrides: ["judges"],
      },
      models: {
        ...makeStamp().models,
        target: {kind: "web-runner", slug: "kora-app-x"},
      },
      input: {path: "in.jsonl", sha256: "00"},
    });
    expect(v.parse(RunStamp.io, JSON.parse(JSON.stringify(stamp)))).toEqual(
      stamp
    );
  });

  it("tolerates unknown fields from newer writers", () => {
    const stamp = {...makeStamp(), future: true};
    expect(() => v.parse(RunStamp.io, stamp)).not.toThrow();
  });
});

describe("RunStamp.describe", () => {
  it("names profile, prompts and packs with markers", () => {
    const text = RunStamp.describe(
      makeStamp({
        profile: {id: "kora", version: "1", hash: "h", overrides: ["user"]},
      })
    );
    expect(text).toMatch(
      /^profile kora@1 \(h\) \[overrides: user\] \| prompts 1 \(prompts-hash\) \| packs kora@2/
    );
  });
});

describe("Stamp", () => {
  it("is undefined until configured", () => {
    expect(Stamp.current()).toBeUndefined();
  });

  it("configure makes the stamp process-wide", () => {
    const stamp = makeStamp();
    Stamp.configure(stamp);
    expect(Stamp.current()).toBe(stamp);
  });

  it("configure is idempotent for an equal stamp", () => {
    Stamp.configure(makeStamp());
    expect(() =>
      Stamp.configure(makeStamp({code: {version: "2"}}))
    ).not.toThrow();
  });

  it("configure refuses a different stamp", () => {
    Stamp.configure(makeStamp());
    expect(() =>
      Stamp.configure(makeStamp({prompts: {version: "2", hash: "x"}}))
    ).toThrow(/called twice with different stamps/);
  });

  it("run scopes a stamp and wins over configure", async () => {
    const outer = makeStamp();
    const inner = makeStamp({prompts: {version: "2", hash: "inner"}});
    Stamp.configure(outer);
    await Stamp.run(inner, async () => {
      await Promise.resolve();
      expect(Stamp.current()).toBe(inner);
    });
    expect(Stamp.current()).toBe(outer);
  });

  it("run stays isolated across concurrent tasks", async () => {
    const a = makeStamp({prompts: {version: "a", hash: "a"}});
    const b = makeStamp({prompts: {version: "b", hash: "b"}});
    const seen = await Promise.all([
      Stamp.run(a, async () => {
        await new Promise(r => setTimeout(r, 5));
        return Stamp.current()?.prompts.hash;
      }),
      Stamp.run(b, async () => {
        await new Promise(r => setTimeout(r, 1));
        return Stamp.current()?.prompts.hash;
      }),
    ]);
    expect(seen).toEqual(["a", "b"]);
  });
});

// The stamp module is reached from every persisted schema, and those reach the
// browser through the package barrel. Keep it free of node builtins, like
// packs.ts (see packScope.test.ts).
describe("stamp/*.ts", () => {
  it("import no node builtin", () => {
    const dir = new URL("../", import.meta.url);
    readdirSync(dir)
      .filter(file => file.endsWith(".ts"))
      .forEach(file => {
        const source = readFileSync(new URL(file, dir), "utf8");
        expect(source, file).not.toMatch(/from\s+"node:/);
      });
  });
});
