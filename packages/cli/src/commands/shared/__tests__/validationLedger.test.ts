import {ScenarioSeed} from "@korabench/benchmark";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {describe, expect, it} from "vitest";
import {
  openLedger,
  populationRowOf,
  readLedger,
  ValidationAttempt,
  validationPathsFor,
} from "../validationLedger.js";

function freshFile(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "kora-ledger-")),
    "seeds.validation.private.jsonl"
  );
}

const seed: ScenarioSeed = {
  id: "seed-1",
  riskCategoryId: "category",
  riskId: "risk",
  ageRange: "10to12",
  motivation: {name: "Curiosity", description: "Wants to know."},
  childAge: 11,
  childGender: "girl",
  childRaceEthnicity: "other",
  childSES: "low",
  shortTitle: "Title",
  coreBehavior: "Core behavior of the seed.",
  context: "Context of the seed.",
  notes: "",
  riskSignalType: "subtle",
  socialContext: "alone",
  use: "homework",
  refusalBehavior: "insists",
  memory: "none",
  goldStandardId: "7.3",
  situationType: "Account / data flow",
};

function row(
  key: string,
  verdict: "pass" | "fail"
): Omit<ValidationAttempt, "attempt" | "at"> {
  return {
    stage: "seed",
    key,
    seedId: `${key}-seed`,
    verdict,
    generatorModel: "generator",
    validatorModel: "validator",
    population: populationRowOf(seed, false),
  };
}

describe("populationRowOf", () => {
  it("carries every assigned value and the private flag, and no narrative", () => {
    expect(populationRowOf(seed, true)).toEqual({
      riskCategoryId: "category",
      riskId: "risk",
      goldStandardId: "7.3",
      situationType: "Account / data flow",
      ageRange: "10to12",
      childAge: 11,
      childGender: "girl",
      childRaceEthnicity: "other",
      childSES: "low",
      motivation: "Curiosity",
      use: "homework",
      socialContext: "alone",
      riskSignalType: "subtle",
      refusalBehavior: "insists",
      memory: "none",
      private: true,
    });
  });
});

describe("validationPathsFor", () => {
  it("names the ledger as a private file next to the output", () => {
    expect(validationPathsFor("data/run/seeds.jsonl")).toEqual({
      ledger: path.join("data/run", "seeds.validation.private.jsonl"),
      reportMd: path.join("data/run", "seeds.validation-report.md"),
      reportJson: path.join("data/run", "seeds.validation-report.json"),
    });
  });
});

describe("openLedger", () => {
  it("numbers the attempts of each key", async () => {
    const file = freshFile();
    const ledger = await openLedger(file, {fresh: true});
    await ledger.record(row("a", "fail"));
    await ledger.record(row("b", "pass"));
    await ledger.record(row("a", "pass"));
    expect(
      (await readLedger(file)).map(r => [r.key, r.attempt, r.verdict])
    ).toEqual([
      ["a", 1, "fail"],
      ["b", 1, "pass"],
      ["a", 2, "pass"],
    ]);
  });

  it("continues the numbering when reopened, and starts over when fresh", async () => {
    const file = freshFile();
    await (await openLedger(file, {fresh: true})).record(row("a", "fail"));
    await (await openLedger(file, {fresh: false})).record(row("a", "fail"));
    expect((await readLedger(file)).map(r => r.attempt)).toEqual([1, 2]);

    await (await openLedger(file, {fresh: true})).record(row("a", "pass"));
    expect((await readLedger(file)).map(r => r.attempt)).toEqual([1]);
  });

  it("reads a missing ledger as empty", async () => {
    expect(
      await readLedger(path.join(tmpdir(), "kora-no-such-ledger"))
    ).toEqual([]);
  });
});
