import {ScenarioPrompt} from "@korabench/benchmark";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
  countTestTasks,
  readScenariosFromJsonl,
  scenariosToTestTasks,
} from "../runCommand.js";

// Two riskIds we expect to be well-represented in data/scenarios.jsonl.
const RISK_A = "violence_and_physical_harm";
const RISK_B = "self_harm_and_eating_disorders";
const N_A = 5;
const N_B = 3;
const TOTAL = N_A + N_B;

const prompts: readonly ScenarioPrompt[] = ["default"];

let tmpDir: string;
let fixturePath: string;

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

beforeAll(() => {
  const source = path.resolve(
    import.meta.dirname,
    "../../../../../data/scenarios.jsonl"
  );
  const lines = readFileSync(source, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0);

  const pick = (riskId: string, n: number) => {
    const matched = lines.filter(l => JSON.parse(l).seed.riskId === riskId);
    if (matched.length < n) {
      throw new Error(
        `Fixture setup: ${source} only has ${matched.length} scenarios for ${riskId}, need ${n}`
      );
    }
    return matched.slice(0, n);
  };

  tmpDir = mkdtempSync(path.join(tmpdir(), "kora-filter-test-"));
  fixturePath = path.join(tmpDir, "scenarios.jsonl");
  writeFileSync(
    fixturePath,
    [...pick(RISK_A, N_A), ...pick(RISK_B, N_B)].join("\n") + "\n"
  );
});

afterAll(() => {
  rmSync(tmpDir, {recursive: true, force: true});
});

describe("readScenariosFromJsonl", () => {
  it("yields every scenario with no filter", async () => {
    const all = await collect(readScenariosFromJsonl(fixturePath));
    expect(all).toHaveLength(TOTAL);
  });

  it("keeps only scenarios matching riskIds", async () => {
    const a = await collect(
      readScenariosFromJsonl(fixturePath, {riskIds: new Set([RISK_A])})
    );
    expect(a).toHaveLength(N_A);
    expect(a.every(s => s.seed.riskId === RISK_A)).toBe(true);
  });

  it("combines multiple riskIds", async () => {
    const both = await collect(
      readScenariosFromJsonl(fixturePath, {
        riskIds: new Set([RISK_A, RISK_B]),
      })
    );
    expect(both).toHaveLength(TOTAL);
  });

  it("yields nothing for an unknown riskId", async () => {
    const none = await collect(
      readScenariosFromJsonl(fixturePath, {riskIds: new Set(["bogus"])})
    );
    expect(none).toHaveLength(0);
  });
});

describe("countTestTasks", () => {
  it("returns the full task count with no filters", async () => {
    const n = await countTestTasks(fixturePath, prompts, {});
    expect(n).toBe(TOTAL);
  });

  it("caps at limit when limit < total", async () => {
    const n = await countTestTasks(fixturePath, prompts, {limit: 2});
    expect(n).toBe(2);
  });

  it("returns total when limit exceeds the dataset", async () => {
    const n = await countTestTasks(fixturePath, prompts, {limit: 500});
    expect(n).toBe(TOTAL);
  });

  it("applies riskIds and limit together (limit binds)", async () => {
    const n = await countTestTasks(fixturePath, prompts, {
      riskIds: new Set([RISK_A]),
      limit: 2,
    });
    expect(n).toBe(2);
  });

  it("applies riskIds and limit together (riskIds binds)", async () => {
    const n = await countTestTasks(fixturePath, prompts, {
      riskIds: new Set([RISK_A]),
      limit: 500,
    });
    expect(n).toBe(N_A);
  });

  it("returns 0 for an unknown riskId", async () => {
    const n = await countTestTasks(fixturePath, prompts, {
      riskIds: new Set(["bogus"]),
    });
    expect(n).toBe(0);
  });
});

describe("scenariosToTestTasks", () => {
  it("yields a task per scenario with no filters", async () => {
    const tasks = await collect(scenariosToTestTasks(fixturePath, prompts, {}));
    expect(tasks).toHaveLength(TOTAL);
  });

  it("stops yielding once limit is reached", async () => {
    const tasks = await collect(
      scenariosToTestTasks(fixturePath, prompts, {limit: 3})
    );
    expect(tasks).toHaveLength(3);
  });

  it("combines riskIds and limit", async () => {
    const tasks = await collect(
      scenariosToTestTasks(fixturePath, prompts, {
        riskIds: new Set([RISK_B]),
        limit: 2,
      })
    );
    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.scenario.seed.riskId === RISK_B)).toBe(true);
  });

  it("yields all filtered tasks when limit exceeds the filtered set", async () => {
    const tasks = await collect(
      scenariosToTestTasks(fixturePath, prompts, {
        riskIds: new Set([RISK_B]),
        limit: 500,
      })
    );
    expect(tasks).toHaveLength(N_B);
    expect(tasks.every(t => t.scenario.seed.riskId === RISK_B)).toBe(true);
  });
});
