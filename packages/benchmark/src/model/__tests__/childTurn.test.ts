import {describe, expect, it} from "vitest";
import {ChildTurn} from "../childTurn.js";

function turn(n: number, leaving: boolean | null): ChildTurn {
  return {
    turn: n,
    status: "unchanged",
    issueCount: 0,
    editCount: 0,
    endMarkerRedraws: 0,
    leaving,
  };
}

// user0, assistant0, user1, assistant1, ...
const messages = ["u0", "a0", "u1", "a1", "u2", "a2", "u3", "a3"];

describe("ChildTurn.leftAtTurn", () => {
  it("is the first turn the child leaves on", () => {
    expect(
      ChildTurn.leftAtTurn([turn(1, false), turn(3, true), turn(2, true)])
    ).toBe(2);
  });

  it("is undefined when the child never leaves", () => {
    expect(ChildTurn.leftAtTurn([turn(1, false), turn(2, null)])).toBe(
      undefined
    );
    expect(ChildTurn.leftAtTurn([])).toBe(undefined);
  });
});

describe("ChildTurn.judgedMessages", () => {
  it("keeps the leaving message and the AI's answer to it", () => {
    expect(
      ChildTurn.judgedMessages(messages, [turn(1, false), turn(2, true)])
    ).toEqual(["u0", "a0", "u1", "a1", "u2", "a2"]);
  });

  it("keeps the whole conversation when the child stays", () => {
    expect(ChildTurn.judgedMessages(messages, [turn(1, false)])).toEqual(
      messages
    );
  });
});
