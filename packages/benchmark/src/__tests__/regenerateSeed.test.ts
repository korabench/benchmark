import {describe, expect, it} from "vitest";
import type {GenerateSeedsContext} from "../benchmark.js";
import {regenerateSeed} from "../kora.js";
import {SeedValidation} from "../model/seedValidation.js";
import {createScenarioSeed} from "./fixtures.js";

const yes = {reason: "Fine as written.", answer: "yes" as const};
const validation = (rejected: boolean): SeedValidation => ({
  plausibleForChild: yes,
  matchesSituation: rejected
    ? {reason: "Not the situation.", answer: "no"}
    : yes,
  showsMotivation: yes,
  showsUse: yes,
  addressesAI: yes,
});

function userPromptOf(request: {
  messages: readonly {role: string; content: unknown}[];
}): string {
  return String(request.messages.find(m => m.role === "user")?.content ?? "");
}

function context(options: {reject?: boolean} = {}) {
  const prompts: string[] = [];
  const c: GenerateSeedsContext = {
    getResponse: async request => {
      prompts.push(userPromptOf(request));
      return {
        output: {
          shortTitle: "New title",
          coreBehavior: "The child asks for the thing the risk turns on.",
          context: "A new context.",
          notes: "New notes.",
        } as never,
      };
    },
    getValidationResponse: async () => ({
      output: validation(options.reject ?? false) as never,
    }),
  };
  return {c, prompts};
}

const seed = createScenarioSeed({
  id: "kept-id",
  childGender: "girl",
  relabeled: {riskSignalType: {from: "ambiguous"}},
});

describe("regenerateSeed", () => {
  it("writes new text in the same slot: id, assigned values and relabels kept", async () => {
    const {c, prompts} = context();
    const reasons = ["firstMessageTestsRisk: The request has no hook."];
    const regenerated = await regenerateSeed(c, seed, reasons);

    expect(regenerated).toBeDefined();
    expect(regenerated!.id).toBe("kept-id");
    expect(regenerated!.coreBehavior).toBe(
      "The child asks for the thing the risk turns on."
    );
    for (const field of [
      "riskId",
      "ageRange",
      "childAge",
      "childGender",
      "childRaceEthnicity",
      "childSES",
      "riskSignalType",
      "socialContext",
      "use",
      "refusalBehavior",
      "memory",
    ] as const) {
      expect(regenerated![field]).toEqual(seed[field]);
    }
    expect(regenerated!.motivation).toEqual(seed.motivation);
    expect(regenerated!.relabeled).toEqual(seed.relabeled);
    expect(regenerated!.regenerated).toEqual({reasons});
    expect(prompts[0]).toContain("could not be expanded");
    expect(prompts[0]).toContain("The request has no hook.");
    expect(prompts[0]).toContain(seed.coreBehavior);
  });

  it("gives up when the plausibility check rejects every rewrite", async () => {
    const {c, prompts} = context({reject: true});
    expect(await regenerateSeed(c, seed, ["x"], {maxAttempts: 2})).toBe(
      undefined
    );
    expect(prompts).toHaveLength(2);
  });

  it("refuses a seed the current generator did not allocate", async () => {
    const {c} = context();
    await expect(
      regenerateSeed(c, createScenarioSeed({childGender: "female"}), ["x"])
    ).rejects.toThrow("cannot be rebuilt");
  });
});
