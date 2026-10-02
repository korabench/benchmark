import {describe, expect, it} from "vitest";
import {isPrivatePath, privatePathFor} from "../privatePath.js";

describe("privatePathFor", () => {
  it("inserts .private before the extension", () => {
    expect(privatePathFor("data/scenarioSeeds.jsonl")).toBe(
      "data/scenarioSeeds.private.jsonl"
    );
    expect(privatePathFor("scenarios.v2.jsonl")).toBe(
      "scenarios.v2.private.jsonl"
    );
  });

  it("returns a private path unchanged", () => {
    expect(privatePathFor("data/scenarios.private.jsonl")).toBe(
      "data/scenarios.private.jsonl"
    );
  });

  it("rejects a path without extension", () => {
    expect(() => privatePathFor("data/seeds")).toThrow();
  });
});

describe("isPrivatePath", () => {
  it("looks at the file name only", () => {
    expect(isPrivatePath("data/scenarios.private.jsonl")).toBe(true);
    expect(isPrivatePath("data/scenarios.jsonl")).toBe(false);
    expect(isPrivatePath("my.private.dir/scenarios.jsonl")).toBe(false);
  });
});
