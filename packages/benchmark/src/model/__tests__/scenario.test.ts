import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {createScenario} from "../../__tests__/fixtures.js";
import {MimesisPatch} from "../../child/mimesisPatch.js";
import {makeStamp} from "../../stamp/__tests__/fixtures.js";
import {Scenario} from "../scenario.js";

describe("Scenario.io revisions", () => {
  const revision = {
    field: "firstUserMessage" as const,
    previous: "the opening the experts reviewed",
    reason: "Child model swapped",
    childSimulator: MimesisPatch.recipeRef(),
    stamp: makeStamp(),
  };

  it("accepts a scenario without revisions, as expanded", () => {
    expect(v.safeParse(Scenario.io, createScenario()).success).toBe(true);
  });

  it("accepts revised openings, with or without a child recipe", () => {
    const scenario = createScenario({
      revisions: [revision, {...revision, childSimulator: undefined}],
    });
    expect(v.parse(Scenario.io, scenario).revisions).toHaveLength(2);
  });

  it("rejects a revision of another field", () => {
    const scenario = {
      ...createScenario(),
      revisions: [{...revision, field: "narrative"}],
    };
    expect(v.safeParse(Scenario.io, scenario).success).toBe(false);
  });
});

describe("MimesisPatch.recipeRef", () => {
  it("names the recipe by content", () => {
    const ref = MimesisPatch.recipeRef();
    expect(ref).toMatchObject({
      id: MimesisPatch.recipe.id,
      version: MimesisPatch.recipe.version,
    });
    expect(ref.hash).toMatch(/\S+/);
    expect(MimesisPatch.recipeRef()).toEqual(ref);
  });
});
