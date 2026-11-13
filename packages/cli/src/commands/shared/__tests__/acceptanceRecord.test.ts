import {describe, expect, it} from "vitest";
import {makeStamp} from "../../../stamp/__tests__/fixtures.js";
import {
  AcceptanceStep,
  buildAcceptanceRecord,
  formatAcceptanceRecord,
} from "../acceptanceRecord.js";
import {buildPassRateReport} from "../passRateReport.js";

const steps = new Map<string, AcceptanceStep>([
  ["a", "attempts"],
  ["b", "attempts"],
  ["c", "relabeled"],
  ["d", "regenerated"],
  ["e", "rejected"],
  ["f", "earlier run"],
]);

const record = buildAcceptanceRecord({
  stamp: makeStamp(),
  stampHash: "stamp-hash",
  childSimulator: {id: "child", version: "5", hash: "abc"},
  steps,
  scenarios: 5,
  rejected: [{seedId: "e", reasons: "firstMessageTestsRisk: no hook"}],
  report: buildPassRateReport({stage: "expansion", rows: []}),
});

describe("buildAcceptanceRecord", () => {
  it("counts the seeds by how far they went and lists the moved and rejected ones", () => {
    expect(record.seeds).toBe(6);
    expect(record.steps).toEqual({
      attempts: 2,
      relabeled: 1,
      regenerated: 1,
      "earlier run": 1,
      rejected: 1,
    });
    expect(record.relabeled).toEqual(["c"]);
    expect(record.regenerated).toEqual(["d"]);
    expect(record.rejected).toEqual([
      {seedId: "e", reasons: "firstMessageTestsRisk: no hook"},
    ]);
  });
});

describe("formatAcceptanceRecord", () => {
  it("names the build and what is left", () => {
    const md = formatAcceptanceRecord(record);
    expect(md).toContain("1 seed(s) without a scenario");
    expect(md).toContain("- Stamp: stamp-hash");
    expect(md).toContain("- Child: child@5 (abc)");
    expect(md).toContain("- e: firstMessageTestsRisk: no hook");
  });
});
