import {describe, expect, it} from "vitest";
import {createScenarioSeed} from "../../__tests__/fixtures.js";
import {relabelSignalType} from "../relabelSignalType.js";
import {SituationMask} from "../situationMask.js";

const mask: SituationMask = {
  use: [],
  riskSignalType: [
    {
      situationType: "Direct request",
      forbidden: ["ambiguous"],
      reason: "test",
    },
    {
      situationType: "Only ambiguous",
      forbidden: ["direct", "subtle"],
      reason: "test",
    },
  ],
};

function seedWith(
  riskSignalType: "direct" | "subtle" | "ambiguous",
  situationType = "Direct request"
) {
  return createScenarioSeed({riskSignalType, situationType});
}

describe("relabelSignalType", () => {
  it("moves ambiguous and direct to subtle, and subtle to direct", () => {
    expect(relabelSignalType(seedWith("ambiguous"), mask)?.riskSignalType).toBe(
      "subtle"
    );
    expect(relabelSignalType(seedWith("direct"), mask)?.riskSignalType).toBe(
      "subtle"
    );
    expect(relabelSignalType(seedWith("subtle"), mask)?.riskSignalType).toBe(
      "direct"
    );
  });

  it("keeps the assigned value on the seed and changes nothing else", () => {
    const seed = seedWith("ambiguous");
    const relabeled = relabelSignalType(seed, mask)!;
    expect(relabeled.relabeled).toEqual({riskSignalType: {from: "ambiguous"}});
    expect({
      ...relabeled,
      riskSignalType: seed.riskSignalType,
      relabeled: undefined,
    }).toEqual({...seed, relabeled: undefined});
  });

  it("skips a value the situation type forbids", () => {
    const seed = seedWith("ambiguous", "Only ambiguous");
    expect(relabelSignalType(seed, mask)).toBeUndefined();
    const direct = seedWith("subtle", "Direct request");
    expect(relabelSignalType(direct, mask)?.riskSignalType).toBe("direct");
  });

  it("relabels a seed only once", () => {
    const once = relabelSignalType(seedWith("ambiguous"), mask)!;
    expect(relabelSignalType(once, mask)).toBeUndefined();
  });

  it("uses the bundled mask by default, and treats a seed without a situation type as unmasked", () => {
    const legacy = createScenarioSeed({
      riskSignalType: "ambiguous",
      situationType: undefined,
      goldStandardId: undefined,
    });
    expect(relabelSignalType(legacy)?.riskSignalType).toBe("subtle");
  });
});
