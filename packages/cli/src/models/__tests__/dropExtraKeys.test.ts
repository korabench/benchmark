import * as v from "valibot";
import {describe, expect, it} from "vitest";
import {parseDroppingExtraKeys} from "../dropExtraKeys.js";

const Schema = v.strictObject({
  grade: v.string(),
  criteria: v.strictObject({c2: v.strictObject({assessment: v.string()})}),
});

describe("parseDroppingExtraKeys", () => {
  it("passes a conforming answer through", () => {
    const value = {grade: "adequate", criteria: {c2: {assessment: "met"}}};
    expect(parseDroppingExtraKeys(Schema, value)).toEqual({
      output: value,
      dropped: [],
    });
  });

  it("drops keys the schema does not define, at any depth", () => {
    const value = {
      grade: "adequate",
      grade_note: "x",
      criteria: {c2: {assessment: "met", why: "y"}},
    };
    const result = parseDroppingExtraKeys(Schema, value);
    expect(result.output).toEqual({
      grade: "adequate",
      criteria: {c2: {assessment: "met"}},
    });
    expect(result.dropped.sort()).toEqual(["criteria.c2.why", "grade_note"]);
  });

  it("still fails on any other issue", () => {
    expect(() =>
      parseDroppingExtraKeys(Schema, {grade: "adequate", extra: 1, criteria: {}})
    ).toThrow(v.ValiError);
  });
});
