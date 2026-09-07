import {describe, expect, it} from "vitest";
import {makeRoles, makeSpec} from "../../../profiles/__tests__/fixtures.js";
import {EffectiveProfile} from "../../../profiles/effectiveProfile.js";
import {Profile} from "../../../profiles/profile.js";
import {makeStamp} from "../../../stamp/__tests__/fixtures.js";
import {buildResultHeader} from "../resultHeader.js";

const effective: EffectiveProfile = {
  ref: {id: "test", version: "1", hash: "h"},
  roles: Profile.effectiveRoles(
    makeRoles({
      judges: [makeSpec("j1"), makeSpec("j2"), makeSpec("j3")],
      continueUser: makeSpec("cu"),
    })
  ),
};

describe("buildResultHeader", () => {
  it("keeps the historical fields and adds the stamp", () => {
    const stamp = makeStamp();
    const header = buildResultHeader({
      target: "gpt-x",
      effective,
      prompts: ["default"],
      stamp,
    });
    expect(Object.keys(header)).toEqual([
      "target",
      "judges",
      "user",
      "prompts",
      "packs",
      "stamp",
    ]);
    expect(header.judges).toEqual(["j1", "j2", "j3"]);
    expect(header.user).toBe("user-a");
    expect(header.packs).toBe(stamp.packs);
    expect(header.stamp).toBe(stamp);
  });

  it("takes an explicit user name and served ids", () => {
    const header = buildResultHeader({
      target: "gpt-x",
      effective,
      prompts: ["default"],
      stamp: makeStamp(),
      userName: "cu",
      served: {user: ["deepseek/x"], judges: {j1: ["openai/y"]}},
    });
    expect(header.user).toBe("cu");
    expect(header.served).toEqual({
      user: ["deepseek/x"],
      judges: {j1: ["openai/y"]},
    });
  });
});
