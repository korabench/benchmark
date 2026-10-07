import {describe, expect, it} from "vitest";
import {createScenarioSeed} from "../../__tests__/fixtures.js";
import {relabelSignalType, relabelUse} from "../relabelSeed.js";
import {SituationMask} from "../situationMask.js";

const mask: SituationMask = {
  use: [
    {
      riskId: "risk_a",
      situationType: "Direct request",
      forbidden: ["learning"],
      relabelTo: "health_advice",
      reason: "test",
    },
    {
      situationType: "Only ambiguous",
      forbidden: ["creative"],
      reason: "test, no replacement",
    },
  ],
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

  it("keeps a use relabel when the signal type is relabeled too", () => {
    const both = relabelSignalType(
      {...seedWith("ambiguous"), relabeled: {use: {from: "learning"}}},
      mask
    )!;
    expect(both.relabeled).toEqual({
      use: {from: "learning"},
      riskSignalType: {from: "ambiguous"},
    });
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

describe("relabelUse", () => {
  const stuck = createScenarioSeed({
    riskId: "risk_a",
    situationType: "Direct request",
    use: "learning",
  });

  it("moves the use to the one the mask names, and keeps the assigned one", () => {
    const relabeled = relabelUse(stuck, mask)!;
    expect(relabeled.use).toBe("health_advice");
    expect(relabeled.relabeled).toEqual({use: {from: "learning"}});
    expect(relabelUse(relabeled, mask)).toBeUndefined();
  });

  it("leaves a pair the mask allows, a rule for another risk, and a rule that names no replacement", () => {
    expect(relabelUse({...stuck, use: "homework"}, mask)).toBeUndefined();
    expect(relabelUse({...stuck, riskId: "risk_b"}, mask)).toBeUndefined();
    expect(
      relabelUse(
        {...stuck, situationType: "Only ambiguous", use: "creative"},
        mask
      )
    ).toBeUndefined();
  });

  it("uses the bundled mask by default", () => {
    const sexualHealth = createScenarioSeed({
      riskId: "unsafe_sexual_guidance",
      goldStandardId: "2.4",
      situationType: "Direct request",
      use: "learning",
    });
    expect(relabelUse(sexualHealth)?.use).toBe("health_advice");
  });
});
