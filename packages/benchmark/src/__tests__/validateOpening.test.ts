import {describe, expect, it, vi} from "vitest";
import {PlaceholderError} from "../generateUserMessage.js";
import {ScenarioValidation} from "../model/scenarioValidation.js";
import {
  validateConfirmed,
  validateScenario,
  verdictsOf,
  writeValidatedOpening,
} from "../validateOpening.js";
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

describe("validateConfirmed", () => {
  const rejected = validation({verdict: "fail", reasons: "Implausible."});

  it("asks once when the scenario passes", async () => {
    const c = context([validation(), rejected], []);
    const verdict = await validateConfirmed(c as never, scenario, 0);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.rechecked).toBeUndefined();
    expect(verdictsOf(verdict)).toHaveLength(1);
  });

  it("passes a rejection the second validation takes back, and keeps both", async () => {
    const c = context([rejected, validation()], []);
    const verdict = await validateConfirmed(c as never, scenario, 0);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.rechecked?.verdict).toBe("fail");
    expect(
      verdictsOf(verdict).map(v => [v.verdict.verdict, v.recheck])
    ).toEqual([
      ["fail", false],
      ["pass", true],
    ]);
  });

  it("rejects only when both validations fail, on the second one's reasons", async () => {
    const second = validation({verdict: "fail", reasons: "Still implausible."});
    const c = context([rejected, second], []);
    const verdict = await validateConfirmed(c as never, scenario, 0);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.reasons).toContain("Still implausible.");
  });

  it("asks once with recheck off", async () => {
    const c = context([rejected, validation()], []);
    const verdict = await validateConfirmed(c as never, scenario, 0, {
      recheck: false,
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.rechecked).toBeUndefined();
  });
});

describe("writeValidatedOpening with recheck", () => {
  it("reports both verdicts of a rechecked opening, the second marked", async () => {
    const c = context(
      [validation({firstMessageShowsUse: no}), validation()],
      ["first"]
    );
    const events: [string, boolean][] = [];
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
      onVerdict: e => {
        events.push([e.verdict.verdict, e.recheck]);
      },
    });
    expect(written.attempts).toBe(1);
    expect(written.last.verdict).toBe("pass");
    expect(events).toEqual([
      ["fail", false],
      ["pass", true],
    ]);
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
      recheck: false,
      maxAttempts: 2,
      retryAnyRejection: true,
    });
    expect(written).toMatchObject({firstUserMessage: "matches", attempts: 2});
    expect(written.last.verdict).toBe("pass");
  });

  it("keeps the first opening that passes", async () => {
    const c = context([validation()], ["first"]);
    const written = await writeValidatedOpening(c as never, scenario, {
      recheck: false,
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
      recheck: false,
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
      recheck: false,
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
      recheck: false,
      maxAttempts: 2,
    });
    expect(written).toMatchObject({firstUserMessage: "two", attempts: 2});
    expect(written.last.verdict).toBe("fail");
  });
});

describe("an opening that keeps a placeholder", () => {
  it("is written again with the reason, not an error", async () => {
    const openings = ["hi [name]", "hi [friend]", "hi [teacher]", "hi Sam"];
    let o = 0;
    const getChildResponse = vi.fn(async (request: {feedback?: unknown}) => ({
      output: openings[o++] ?? "",
      feedback: request.feedback,
    }));
    const c = {...context([validation()], []), getChildResponse};
    const written = await writeValidatedOpening(c as never, scenario, {
      maxAttempts: 2,
      recheck: false,
    });
    expect(written.firstUserMessage).toBe("hi Sam");
    expect(getChildResponse.mock.calls[3]![0].feedback).toEqual({
      previousMessage: "hi [teacher]",
      reasons: [PlaceholderError.reason],
    });
  });

  it("throws the placeholder once the attempts are spent", async () => {
    const c = context([validation()], ["a [x1]", "b [x2]", "c [x3]"]);
    await expect(
      writeValidatedOpening(c as never, scenario, {maxAttempts: 1})
    ).rejects.toBeInstanceOf(PlaceholderError);
  });
});
