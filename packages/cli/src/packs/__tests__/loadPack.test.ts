import {Packs} from "@korabench/benchmark";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {resolveBehaviors, resolveTaxonomy} from "../loadPack.js";

afterEach(() => Packs.reset());

const dir = mkdtempSync(path.join(tmpdir(), "kora-packs-"));

function writeJson(name: string, value: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

describe("resolveTaxonomy", () => {
  it("resolves the bundled pack by name", () => {
    expect(resolveTaxonomy("kora").id).toBe("kora");
  });

  it("lists known packs for an unknown name", () => {
    expect(() => resolveTaxonomy("nope")).toThrow(
      /Unknown taxonomy pack "nope". Known packs: kora/
    );
  });

  it("loads a taxonomy from a path", () => {
    const filePath = writeJson("taxonomy.json", {
      id: "custom",
      version: "9",
      categories: [
        {
          id: "cat",
          name: "Cat",
          risks: [
            {id: "risk", name: "r", description: "d", conversationLength: 3},
          ],
        },
      ],
    });

    expect(resolveTaxonomy(filePath).id).toBe("custom");
  });

  it("reports the path when a file is missing", () => {
    expect(() => resolveTaxonomy(path.join(dir, "absent.json"))).toThrow(
      /Could not read taxonomy pack from .*absent\.json/
    );
  });

  // The bundled data file is a bare array; a supplied pack must be the full
  // envelope, so the loader never has to guess which shape it is holding.
  it("rejects the bare-array shape", () => {
    const filePath = writeJson("bare.json", [
      {id: "cat", name: "Cat", risks: []},
    ]);
    expect(() => resolveTaxonomy(filePath)).toThrow();
  });
});

describe("resolveBehaviors", () => {
  it("resolves the bundled pack by name", () => {
    expect(resolveBehaviors("kora").behaviors).toHaveLength(7);
  });

  it("loads a behavior set from a path", () => {
    const filePath = writeJson("behaviors.json", {
      id: "custom",
      version: "1",
      behaviors: [
        {
          id: "only",
          name: "Only",
          level: "conversation",
          assessmentPrompt: "DEFINITION: …",
        },
      ],
    });

    expect(resolveBehaviors(filePath).behaviors.map(b => b.id)).toEqual([
      "only",
    ]);
  });
});
