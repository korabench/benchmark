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

// A Cloudflare build asks for the `browser` condition as well as `workerd`, so
// a map that answers `browser` first hands a worker the stack scope — which
// drops the active pack at the first await, silently, in the one runtime that
// serves concurrent runs. Order is the whole fix, and nothing in a type or a
// unit test would catch it: the app-website worker bundle shipped StackScope
// until `workerd` was added ahead of `browser`.
describe("#packScope conditions", () => {
  const conditions = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
  ).imports["#packScope"] as Record<string, string>;

  it("answers workerd with the node scope, before browser is considered", () => {
    const order = Object.keys(conditions);

    expect(conditions.workerd).toBe(conditions.default);
    expect(conditions.workerd).toMatch(/packScope\.node\.js$/);
    expect(order.indexOf("workerd")).toBeLessThan(order.indexOf("browser"));
  });

  it("keeps the browser on the node-free scope", () => {
    expect(conditions.browser).toMatch(/packScope\.browser\.js$/);
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
