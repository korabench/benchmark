import {Packs, TaxonomyConformanceError} from "@korabench/benchmark";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {assertInputConforms} from "../shared/validateInputFile.js";

afterEach(() => Packs.reset());

const dir = mkdtempSync(path.join(tmpdir(), "kora-validate-"));

function seed(riskId: string, riskCategoryId = "online_safety") {
  return {
    childAge: 12,
    childGender: "female",
    childRaceEthnicity: "asian",
    childCognitiveMaturity: "medium",
    childEmotionalMaturity: "medium",
    shortTitle: "A short title",
    riskSignalType: "direct",
    coreBehavior: "The child does something risky online.",
    socialContext: "alone",
    context: "The child is browsing alone after school.",
    notes: "",
    id: `seed-${riskId}`,
    riskCategoryId,
    riskId,
    ageRange: "10to12",
    motivation: {name: "Curiosity", description: "d"},
  };
}

function writeSeeds(name: string, seeds: readonly unknown[]): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, seeds.map(s => JSON.stringify(s)).join("\n") + "\n");
  return filePath;
}

describe("assertInputConforms", () => {
  it("counts records when everything resolves", async () => {
    const filePath = writeSeeds("ok.jsonl", [
      seed("cybersecurity"),
      seed("privacy_and_personal_data_protection"),
    ]);

    await expect(assertInputConforms(filePath, "seeds")).resolves.toBe(2);
  });

  it("names the offending line", async () => {
    const filePath = writeSeeds("bad.jsonl", [
      seed("cybersecurity"),
      seed("privacy_and_personal_data_protection"),
      seed("not_a_real_risk"),
    ]);

    await expect(assertInputConforms(filePath, "seeds")).rejects.toThrow(
      /line 3.*not_a_real_risk/s
    );
  });

  it("flags a risk sitting under the wrong category", async () => {
    const filePath = writeSeeds("crossed.jsonl", [
      seed("cybersecurity", "developmental_risk"),
    ]);

    await expect(assertInputConforms(filePath, "seeds")).rejects.toThrow(
      /not under category "developmental_risk"/
    );
  });

  it("carries the issues on the error without dumping them when printed", async () => {
    const filePath = writeSeeds("issues.jsonl", [seed("nope")]);

    const error = await assertInputConforms(filePath, "seeds").catch(e => e);

    expect(error).toBeInstanceOf(TaxonomyConformanceError);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].lineNumber).toBe(1);
    // An uncaught error prints its own enumerable properties; the formatted
    // message must not be buried under the raw issue list.
    expect(Object.keys(error)).not.toContain("issues");
  });

  it("validates against the active pack, not the bundled one", async () => {
    const filePath = writeSeeds("scoped.jsonl", [seed("cybersecurity")]);

    await Packs.run(
      {
        taxonomy: {
          id: "narrow",
          version: "1",
          categories: [{id: "online_safety", name: "Online Safety", risks: []}],
        },
      },
      async () => {
        await expect(assertInputConforms(filePath, "seeds")).rejects.toThrow(
          /taxonomy "narrow@1"/
        );
      }
    );
  });
});
