import {describe, expect, it} from "vitest";
import {kora} from "../kora.js";
import {Scenario} from "../model/scenario.js";
import {ScenarioKey, ScenarioPrompt} from "../model/scenarioKey.js";
import {createScenario, createScenarioSeed} from "./fixtures.js";

//
// Tests.
//

describe("ScenarioKey", () => {
  it("round-trips through toString and ofString", () => {
    const key: ScenarioKey = {
      riskCategoryId: "physical_and_legal_safety",
      riskId: "violence_and_physical_harm",
      ageRange: "10to12",
      id: "abc-123",
      prompt: "default",
    };

    const result = ScenarioKey.ofString(ScenarioKey.toString(key));

    expect(result).toEqual(key);
  });

  it("parses a colon-delimited string correctly", () => {
    const result = ScenarioKey.ofString(
      "physical_and_legal_safety:violence_and_physical_harm:7to9:my-id:child"
    );

    expect(result).toEqual({
      riskCategoryId: "physical_and_legal_safety",
      riskId: "violence_and_physical_harm",
      ageRange: "7to9",
      id: "my-id",
      prompt: "child",
    });
  });

  it("throws on invalid ageRange", () => {
    expect(() => ScenarioKey.ofString("cat:risk:99to100:id:default")).toThrow();
  });

  it("extracts correct fields from a scenario via ofScenario", () => {
    const scenario = createScenario({
      seed: createScenarioSeed({
        id: "s-42",
        riskCategoryId: "physical_and_legal_safety",
        riskId: "violence_and_physical_harm",
        ageRange: "13to17",
      }),
    });

    const key = ScenarioKey.ofScenario(scenario, "child");

    expect(key).toEqual({
      riskCategoryId: "physical_and_legal_safety",
      riskId: "violence_and_physical_harm",
      ageRange: "13to17",
      id: "s-42",
      prompt: "child",
    });
  });

  it("toAgeRange returns undefined for default prompt", () => {
    const key: ScenarioKey = {
      riskCategoryId: "cat",
      riskId: "risk",
      ageRange: "10to12",
      id: "id",
      prompt: "default",
    };

    expect(ScenarioKey.toAgeRange(key)).toBeUndefined();
  });

  it("toAgeRange returns the ageRange for child prompt", () => {
    const key: ScenarioKey = {
      riskCategoryId: "cat",
      riskId: "risk",
      ageRange: "10to12",
      id: "id",
      prompt: "child",
    };

    expect(ScenarioKey.toAgeRange(key)).toBe("10to12");
  });
});

describe("Scenario.toKeys", () => {
  it("returns exactly 2 keys: one default and one child", () => {
    const scenario = createScenario();

    const keys = Scenario.toKeys(scenario, ScenarioPrompt.list);

    expect(keys).toHaveLength(2);
    expect(keys[0]!.prompt).toBe("default");
    expect(keys[1]!.prompt).toBe("child");
  });

  it("returns only the requested prompt", () => {
    const scenario = createScenario();

    const keys = Scenario.toKeys(scenario, ["child"]);

    expect(keys).toHaveLength(1);
    expect(keys[0]!.prompt).toBe("child");
  });
});

describe("kora.mapScenarioToKeys", () => {
  it("returns exactly 2 string keys for a scenario", () => {
    const scenario = createScenario();

    const keys = kora.mapScenarioToKeys(scenario, ScenarioPrompt.list);

    expect(keys).toHaveLength(2);
  });

  it("keys contain scenario metadata", () => {
    const scenario = createScenario({
      seed: createScenarioSeed({
        id: "s-99",
        riskCategoryId: "physical_and_legal_safety",
        riskId: "violence_and_physical_harm",
        ageRange: "10to12",
      }),
    });

    const keys = kora.mapScenarioToKeys(scenario, ScenarioPrompt.list);

    for (const key of keys) {
      expect(key).toContain("physical_and_legal_safety");
      expect(key).toContain("violence_and_physical_harm");
      expect(key).toContain("10to12");
      expect(key).toContain("s-99");
    }
  });

  it("one key ends with :default, one with :child", () => {
    const scenario = createScenario();

    const keys = kora.mapScenarioToKeys(scenario, ScenarioPrompt.list);

    expect(keys.filter(k => k.endsWith(":default"))).toHaveLength(1);
    expect(keys.filter(k => k.endsWith(":child"))).toHaveLength(1);
  });

  it("returns only default key when prompts is ['default']", () => {
    const scenario = createScenario();

    const keys = kora.mapScenarioToKeys(scenario, ["default"]);

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/:default$/);
  });

  it("returns only child key when prompts is ['child']", () => {
    const scenario = createScenario();

    const keys = kora.mapScenarioToKeys(scenario, ["child"]);

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/:child$/);
  });
});
