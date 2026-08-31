import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {createPackScope as createBrowserScope} from "../packScope.browser.js";
import {createPackScope as createNodeScope} from "../packScope.node.js";

describe.each([
  ["browser", createBrowserScope],
  ["node", createNodeScope],
])("%s pack scope", (_name, create) => {
  it("has no store outside run()", () => {
    expect(create<string>().getStore()).toBeUndefined();
  });

  it("exposes the store to the callback and returns its value", () => {
    const scope = create<string>();

    expect(scope.run("alpha", () => scope.getStore())).toBe("alpha");
  });

  it("restores the enclosing store, including when fn throws", () => {
    const scope = create<string>();

    scope.run("outer", () => {
      scope.run("inner", () => undefined);
      expect(scope.getStore()).toBe("outer");

      expect(() =>
        scope.run("inner", () => {
          throw new Error("boom");
        })
      ).toThrow("boom");
      expect(scope.getStore()).toBe("outer");
    });

    expect(scope.getStore()).toBeUndefined();
  });
});

// packs.ts is reached from the browser through Mechanism and RiskCategory, so a
// static node builtin in it breaks every client bundle that touches the barrel:
// the build externalizes the builtin to a stub and fails on the named import.
// The scope has to keep coming in through `#packScope`.
describe("packs.ts", () => {
  it("imports no node builtin", () => {
    const source = readFileSync(
      new URL("../packs.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/from\s+"node:/);
  });
});
