import {describe, expect, it} from "vitest";
import {readGitInfo} from "../gitInfo.js";

describe("readGitInfo", () => {
  it("returns a commit sha and dirty flag inside a checkout, or nothing", () => {
    const info = readGitInfo();
    if (info.commit === undefined) {
      expect(info).toEqual({});
      return;
    }
    expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof info.dirty).toBe("boolean");
  });
});
