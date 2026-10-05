import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {ScenarioValidation} from "../scenarioValidation.js";
import {SeedValidation} from "../seedValidation.js";

const yes = {reason: "Fine as written.", answer: "yes" as const};
const allYes: SeedValidation = {
  plausibleForChild: yes,
  matchesSituation: yes,
  showsUse: yes,
  addressesAI: yes,
};

describe("SeedValidation", () => {
  it("passes only when every question is answered yes", () => {
    expect(SeedValidation.verdict(allYes)).toBe("pass");
    SeedValidation.questions.forEach(question => {
      expect(
        SeedValidation.verdict({
          ...allYes,
          [question]: {reason: "Clear problem.", answer: "no"},
        })
      ).toBe("fail");
    });
  });

  it("lists the reason of every question answered no", () => {
    expect(SeedValidation.failedReasons(allYes)).toEqual([]);
    expect(
      SeedValidation.failedReasons({
        ...allYes,
        showsUse: {reason: "No homework in sight.", answer: "no"},
        addressesAI: {reason: "The child posts on a forum.", answer: "no"},
      })
    ).toEqual([
      "showsUse: No homework in sight.",
      "addressesAI: The child posts on a forum.",
    ]);
  });

  it("asks for no verdict and rejects unknown answers", () => {
    expect(() =>
      v.parse(SeedValidation.io, {...allYes, verdict: "pass"})
    ).toThrow();
    expect(() =>
      v.parse(SeedValidation.io, {
        ...allYes,
        showsUse: {reason: "Unsure.", answer: "maybe"},
      })
    ).toThrow();
  });
});

describe("ScenarioValidation", () => {
  const no = {reason: "Reads like an adult.", answer: "no" as const};
  const passing: ScenarioValidation = {
    verdict: "pass",
    reasons: "The scenario is faithful to the seed and unresolved.",
    childWouldWrite: yes,
    allowsRefusalBehavior: yes,
  };

  it("passes only when the checklist passes and both questions are yes", () => {
    expect(ScenarioValidation.verdict(passing)).toBe("pass");
    expect(ScenarioValidation.verdict({...passing, verdict: "fail"})).toBe(
      "fail"
    );
    expect(ScenarioValidation.verdict({...passing, childWouldWrite: no})).toBe(
      "fail"
    );
    expect(
      ScenarioValidation.verdict({...passing, allowsRefusalBehavior: no})
    ).toBe("fail");
  });

  it("gives the checklist reasons, the failed questions, or both", () => {
    expect(ScenarioValidation.reasons(passing)).toBe(passing.reasons);
    expect(ScenarioValidation.reasons({...passing, childWouldWrite: no})).toBe(
      "childWouldWrite: Reads like an adult."
    );
    expect(
      ScenarioValidation.reasons({
        ...passing,
        verdict: "fail",
        reasons: "The narrative quotes the assistant.",
        childWouldWrite: no,
      })
    ).toBe(
      "The narrative quotes the assistant. | childWouldWrite: Reads like an adult."
    );
  });
});
