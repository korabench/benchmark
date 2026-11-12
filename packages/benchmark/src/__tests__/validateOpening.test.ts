import {describe, expect, it, vi} from "vitest";
import {ScenarioValidation} from "../model/scenarioValidation.js";
import {validateScenario, writeValidatedOpening} from "../validateOpening.js";
import {answeringRiskCalls, createScenario} from "./fixtures.js";

//
// Helpers.
//

const yes = {reason: "Fine as written.", answer: "yes" as const};
const no = {reason: "Clear problem here.", answer: "no" as const};

function validation(
  overrides: Partial<ScenarioValidation> = {}
): ScenarioValidation {
  return {
    verdict: "pass",
    reasons: "Well constructed.",
    childWouldWrite: yes,
    allowsRefusalBehavior: yes,
    showsMotivation: yes,
    showsUse: yes,
    firstMessageShowsUse: yes,
    firstMessageShowsSignalType: yes,
    firstMessageTestsRisk: yes,
    ...overrides,
  };
}

/** A validator that answers `verdicts` in turn, and a child that writes
 * `openings` in turn. */
function context(verdicts: ScenarioValidation[], openings: string[]) {
  let v = 0;
  let o = 0;
  return {
    getResponse: answeringRiskCalls(
      vi.fn(async (_request: unknown) => ({output: verdicts[v++]}))
    ),
    getUserResponse: vi.fn(async () => ({output: "unused"})),
    getChildResponse: vi.fn(async () => ({output: openings[o++] ?? ""})),
  } as const;
}

const scenario = createScenario();

//
// Tests.
//

describe("validateScenario", () => {
  it("tells a first-message rejection from a rejection of the scenario", async () => {
    const message = await validateScenario(
      context([validation({firstMessageShowsSignalType: no})], []) as never,
      scenario,
      0
    );
    expect(message.verdict).toBe("fail");
    expect(message.firstMessageOnly).toBe(true);

    const scenarioLevel = await validateScenario(
      context([validation({showsMotivation: no})], []) as never,
      scenario,
      0
    );
    expect(scenarioLevel.verdict).toBe("fail");
    expect(scenarioLevel.firstMessageOnly).toBe(false);
  });
});

describe("the risk question", () => {
  it("is asked in a call of its own and decides firstMessageTestsRisk", async () => {
    const c = context([validation({firstMessageTestsRisk: no})], []);
    const verdict = await validateScenario(c as never, scenario, 0);
    expect(verdict.validation.firstMessageTestsRisk).toEqual(no);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.firstMessageOnly).toBe(true);
    expect(verdict.reasons).toBe("firstMessageTestsRisk: Clear problem here.");
  });
});

describe("writeValidatedOpening", () => {
  it("retries a rejection of the scenario with retryAnyRejection", async () => {
    const c = context(
      [
        validation({
          verdict: "fail",
          reasons: "The narrative quotes another opening.",
        }),
        validation(),
      ],
      ["mismatch", "matches"]
    );
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
      retryAnyRejection: true,
    });
    expect(written).toMatchObject({firstUserMessage: "matches", attempts: 2});
    expect(written.last.verdict).toBe("pass");
  });

  it("keeps the first opening that passes", async () => {
    const c = context([validation()], ["first"]);
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
    });
    expect(written).toMatchObject({firstUserMessage: "first", attempts: 1});
    expect(written.last.verdict).toBe("pass");
  });

  it("writes the opening again after a first-message rejection", async () => {
    const c = context(
      [validation({firstMessageShowsSignalType: no}), validation()],
      ["too direct", "better"]
    );
    const verdicts: string[] = [];
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
      onVerdict: e => {
        verdicts.push(`${e.firstUserMessage}:${e.verdict.verdict}`);
      },
    });
    expect(written.firstUserMessage).toBe("better");
    expect(verdicts).toEqual(["too direct:fail", "better:pass"]);
    // The validator sees each opening it judges.
    expect(JSON.stringify(c.getResponse.mock.calls[1])).toContain("better");
  });

  it("does not retry a rejection of the scenario itself", async () => {
    const c = context([validation({showsUse: no})], ["only"]);
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
    });
    expect(written.attempts).toBe(1);
    expect(written.last.verdict).toBe("fail");
    expect(c.getChildResponse).toHaveBeenCalledTimes(1);
  });

  it("keeps the last opening when every attempt is rejected", async () => {
    const c = context(
      [
        validation({firstMessageShowsUse: no}),
        validation({firstMessageShowsUse: no}),
      ],
      ["one", "two"]
    );
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
    });
    expect(written).toMatchObject({firstUserMessage: "two", attempts: 2});
    expect(written.last.verdict).toBe("fail");
  });
});
