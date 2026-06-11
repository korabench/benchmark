import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {createScenario} from "../../__tests__/fixtures.js";
import {Scenario} from "../scenario.js";

describe("Scenario.io language", () => {
  it("parses scenarios without a language (pre-existing corpora)", () => {
    const parsed = v.parse(Scenario.io, createScenario());

    expect(parsed.language).toBeUndefined();
  });

  it("parses scenarios with a supported language", () => {
    const parsed = v.parse(Scenario.io, createScenario({language: "fr"}));

    expect(parsed.language).toBe("fr");
  });

  it("rejects unsupported languages", () => {
    expect(() =>
      v.parse(Scenario.io, {...createScenario(), language: "de"})
    ).toThrow();
  });
});
