import type {Scenario, ScenarioSeed} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {describe, expect, it} from "vitest";
import {
  rejectedPathsFor,
  writeExpansionOutputs,
} from "../expandScenariosCommand.js";

const seed = (id: string) => ({id, riskId: "r"}) as unknown as ScenarioSeed;
const scenarioOf = (id: string) =>
  ({seed: {id}, firstUserMessage: `hi from ${id}`}) as unknown as Scenario;

async function readLines(file: string): Promise<unknown[]> {
  const content = await fs.readFile(file, "utf-8");
  return content
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line));
}

describe("writeExpansionOutputs", () => {
  it("writes the seeds that passed, in input order, and the rejected ones apart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "expand-"));
    const tempDir = path.join(dir, ".kora-expand-tmp");
    await fs.mkdir(tempDir);
    for (const id of ["c", "a", "p"]) {
      await fs.writeFile(
        path.join(tempDir, `${id}.json`),
        JSON.stringify([scenarioOf(id)])
      );
    }
    const outputFilePath = path.join(dir, "scenarios.jsonl");
    const privateOutputFilePath = path.join(dir, "scenarios.private.jsonl");
    const result = await writeExpansionOutputs({
      ordered: ["a", "b", "c", "p", "q"].map(seed),
      tempDir,
      outputFilePath,
      privateOutputFilePath,
      hasPrivateSeeds: true,
      privateSeedIds: new Set(["p", "q"]),
      rejected: [
        {
          seedId: "q",
          riskId: "r",
          outcome: "rejected",
          reasons: "no hook",
          seed: seed("q"),
        },
        {
          seedId: "b",
          riskId: "r",
          outcome: "error",
          reasons: "timeout",
          seed: seed("b"),
        },
      ],
    });

    expect(result.publicCount).toBe(2);
    expect(result.privateCount).toBe(1);
    expect(
      (await readLines(outputFilePath)).map(s => (s as Scenario).seed.id)
    ).toEqual(["a", "c"]);
    expect(
      (await readLines(privateOutputFilePath)).map(s => (s as Scenario).seed.id)
    ).toEqual(["p"]);
    const paths = rejectedPathsFor(outputFilePath);
    expect(
      (await readLines(paths.public)).map(r => (r as {seedId: string}).seedId)
    ).toEqual(["b"]);
    expect(
      (await readLines(paths.private)).map(r => (r as {seedId: string}).seedId)
    ).toEqual(["q"]);
  });

  it("names the reject files after the output, private beside private", () => {
    expect(rejectedPathsFor("data/scenarios.jsonl")).toEqual({
      public: path.join("data", "scenarios.rejected.jsonl"),
      private: path.join("data", "scenarios.rejected.private.jsonl"),
    });
  });
});
