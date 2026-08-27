import {afterEach, describe, expect, it} from "vitest";
import {Mechanism} from "../../model/mechanism.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {Packs} from "../packs.js";
import {makeBehaviorSet, makeTaxonomy} from "./fixtures.js";

afterEach(() => Packs.reset());

describe("Packs.current", () => {
  it("falls back to the bundled pack", () => {
    expect(Packs.current().taxonomy.id).toBe("kora");
    expect(Packs.isBundledDefault()).toBe(true);
  });
});

describe("Packs.configure", () => {
  it("makes a taxonomy process-wide", () => {
    Packs.configure({taxonomy: makeTaxonomy()});

    expect(RiskCategory.listAll().map(c => c.id)).toEqual(["cat_one"]);
    expect(Packs.isBundledDefault()).toBe(false);
  });

  it("leaves the unspecified half on the bundled pack", () => {
    Packs.configure({taxonomy: makeTaxonomy()});

    expect(Mechanism.listAll()).toHaveLength(7);
  });

  it("is idempotent for identical packs", () => {
    Packs.configure({taxonomy: makeTaxonomy()});
    expect(() => Packs.configure({taxonomy: makeTaxonomy()})).not.toThrow();
  });

  it("throws when reconfigured with a different pack", () => {
    Packs.configure({taxonomy: makeTaxonomy({id: "one"})});
    expect(() =>
      Packs.configure({taxonomy: makeTaxonomy({id: "two"})})
    ).toThrow(/called twice with different packs/);
  });
});

describe("Packs.run", () => {
  it("scopes a pack to its callback and restores afterwards", () => {
    Packs.run({taxonomy: makeTaxonomy()}, () => {
      expect(RiskCategory.listAll().map(c => c.id)).toEqual(["cat_one"]);
    });

    expect(RiskCategory.listAll().map(c => c.id)).toContain("online_safety");
  });

  it("nests", () => {
    Packs.run({taxonomy: makeTaxonomy({id: "outer"})}, () => {
      Packs.run({taxonomy: makeTaxonomy({id: "inner"})}, () => {
        expect(Packs.current().taxonomy.id).toBe("inner");
      });
      expect(Packs.current().taxonomy.id).toBe("outer");
    });
  });

  it("wins over the process-wide configuration", () => {
    Packs.configure({taxonomy: makeTaxonomy({id: "configured"})});

    Packs.run({taxonomy: makeTaxonomy({id: "scoped"})}, () => {
      expect(Packs.current().taxonomy.id).toBe("scoped");
    });
    expect(Packs.current().taxonomy.id).toBe("configured");
  });

  // The Cloudflare case: one isolate, several runs in flight, different packs.
  it("keeps concurrent scopes isolated across awaits", async () => {
    const observed: string[] = [];

    const task = (id: string, delayMs: number) =>
      Packs.run({taxonomy: makeTaxonomy({id})}, async () => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        observed.push(`${id}:${Packs.current().taxonomy.id}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        observed.push(`${id}:${Packs.current().taxonomy.id}`);
      });

    await Promise.all([task("alpha", 6), task("beta", 2)]);

    expect(observed.every(o => o.split(":")[0] === o.split(":")[1])).toBe(true);
    expect(observed).toHaveLength(4);
  });
});

describe("Packs.fingerprint", () => {
  it("is stable for equal content and differs for different content", () => {
    const a = Packs.resolve({taxonomy: makeTaxonomy()});
    const b = Packs.resolve({taxonomy: makeTaxonomy()});
    const c = Packs.resolve({taxonomy: makeTaxonomy({id: "other"})});

    expect(Packs.fingerprint(a).taxonomy.hash).toBe(
      Packs.fingerprint(b).taxonomy.hash
    );
    expect(Packs.fingerprint(a).taxonomy.hash).not.toBe(
      Packs.fingerprint(c).taxonomy.hash
    );
  });

  it("records the behavior pack alongside the taxonomy", () => {
    const packs = Packs.resolve({behaviors: makeBehaviorSet()});
    const stamp = Packs.fingerprint(packs);

    expect(stamp.behaviors.id).toBe("test");
    expect(stamp.taxonomy.id).toBe("kora");
  });
});
