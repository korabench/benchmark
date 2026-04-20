import {ScenarioPrompt} from "@korabench/benchmark";
import * as path from "node:path";
import {describe, expect, it} from "vitest";
import {
  countTestTasks,
  readScenariosFromJsonl,
  scenariosToTestTasks,
} from "../runCommand.js";

// data/sample-scenarios.jsonl ships 30 scenarios of each riskId below.
const fixturePath = path.resolve(
  import.meta.dirname,
  "../../../../../data/sample-scenarios.jsonl"
);

const RISK_PRIVACY = "privacy_and_personal_data_protection";
const RISK_SENSOR = "sensorimotor_displacement";

const prompts: readonly ScenarioPrompt[] = ["default"];

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("readScenariosFromJsonl", () => {
  it("yields every scenario with no filter", async () => {
    const all = await collect(readScenariosFromJsonl(fixturePath));
    expect(all).toHaveLength(60);
  });

  it("keeps only scenarios matching riskIds", async () => {
    const privacy = await collect(
      readScenariosFromJsonl(fixturePath, {riskIds: new Set([RISK_PRIVACY])})
    );
    expect(privacy).toHaveLength(30);
    expect(privacy.every(s => s.seed.riskId === RISK_PRIVACY)).toBe(true);
  });

  it("combines multiple riskIds", async () => {
    const both = await collect(
      readScenariosFromJsonl(fixturePath, {
        riskIds: new Set([RISK_PRIVACY, RISK_SENSOR]),
      })
    );
    expect(both).toHaveLength(60);
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
    expect(n).toBe(60);
  });

  it("caps at limit when limit < total", async () => {
    const n = await countTestTasks(fixturePath, prompts, {limit: 10});
    expect(n).toBe(10);
  });

  it("returns total when limit exceeds the dataset", async () => {
    const n = await countTestTasks(fixturePath, prompts, {limit: 500});
    expect(n).toBe(60);
  });

  it("applies riskIds and limit together (limit binds)", async () => {
    const n = await countTestTasks(fixturePath, prompts, {
      riskIds: new Set([RISK_PRIVACY]),
      limit: 5,
    });
    expect(n).toBe(5);
  });

  it("applies riskIds and limit together (riskIds binds)", async () => {
    const n = await countTestTasks(fixturePath, prompts, {
      riskIds: new Set([RISK_PRIVACY]),
      limit: 500,
    });
    expect(n).toBe(30);
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
    expect(tasks).toHaveLength(60);
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
        riskIds: new Set([RISK_SENSOR]),
        limit: 4,
      })
    );
    expect(tasks).toHaveLength(4);
    expect(tasks.every(t => t.scenario.seed.riskId === RISK_SENSOR)).toBe(true);
  });

  it("yields all filtered tasks when limit is larger than the filtered set", async () => {
    const tasks = await collect(
      scenariosToTestTasks(fixturePath, prompts, {
        riskIds: new Set([RISK_SENSOR]),
        limit: 500,
      })
    );
    expect(tasks).toHaveLength(30);
    expect(tasks.every(t => t.scenario.seed.riskId === RISK_SENSOR)).toBe(true);
  });
});
