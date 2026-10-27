import type {Scenario} from "@korabench/benchmark";
import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {makeStamp} from "../../stamp/__tests__/fixtures.js";
import {reviseOpening} from "../reviseOpeningsCommand.js";

const childSimulator = {id: "child", version: "1", hash: "abc"};

const scenario = {
  seed: {id: "seed-1"},
  shortTitle: "Title",
  childBackground: "Background",
  narrative: "Narrative",
  evaluationCriteria: "Criteria",
  firstUserMessage: "old opening",
  stamp: makeStamp(),
} as unknown as Scenario;

describe("reviseOpening", () => {
  it("changes only the opening and keeps the previous one in revisions", () => {
    const stamp = makeStamp({language: "English"});
    const revised = reviseOpening(scenario, "new opening", {
      reason: "child swap",
      childSimulator,
      stamp,
    });
    expect(revised.firstUserMessage).toBe("new opening");
    expect(R.omit(revised, ["firstUserMessage", "revisions"])).toEqual(
      R.omit(scenario, ["firstUserMessage"])
    );
    expect(revised.stamp).toBe(scenario.stamp);
    expect(revised.revisions).toEqual([
      {
        field: "firstUserMessage",
        previous: "old opening",
        reason: "child swap",
        childSimulator,
        stamp,
      },
    ]);
  });

  it("appends to earlier revisions, oldest first", () => {
    const once = reviseOpening(scenario, "second", {
      reason: "a",
      stamp: makeStamp(),
    });
    const twice = reviseOpening(once, "third", {
      reason: "b",
      stamp: makeStamp(),
    });
    expect(twice.revisions!.map(r => [r.previous, r.reason])).toEqual([
      ["old opening", "a"],
      ["second", "b"],
    ]);
  });
});
