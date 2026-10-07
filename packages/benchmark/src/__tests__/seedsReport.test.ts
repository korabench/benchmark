import {describe, expect, it} from "vitest";
import {RiskCategory} from "../model/riskCategory.js";
import {ScenarioSeed} from "../model/scenarioSeed.js";
import {planSeedSlots, SeedSlot} from "../seedSlots.js";
import {ReportedSeed, SeedsReport} from "../seedsReport.js";
import {createScenarioSeed} from "./fixtures.js";

const privacy = RiskCategory.listAll()
  .flatMap(c => c.risks.map(r => ({category: c, risk: r})))
  .find(({risk}) => risk.id === "privacy_and_personal_data_protection")!;

const options = {
  totalSeeds: 12,
  randomSeed: 7,
  riskIds: [privacy.risk.id],
};

function seedOf(
  slot: SeedSlot,
  overrides: Partial<ScenarioSeed> = {}
): ReportedSeed {
  const a = slot.assignment;
  return {
    isPrivate: slot.isPrivate,
    seed: createScenarioSeed({
      id: slot.key,
      riskCategoryId: slot.riskCategory.id,
      riskId: slot.risk.id,
      ageRange: a.ageRange,
      childAge: a.childAge,
      childGender: a.childGender,
      childRaceEthnicity: a.childRaceEthnicity,
      childSES: a.childSES,
      motivation: a.motivation,
      socialContext: a.socialContext,
      riskSignalType: a.riskSignalType,
      use: a.use,
      refusalBehavior: a.refusalBehavior,
      memory: a.memory,
      goldStandardId: a.situation?.goldStandardId,
      situationType: a.situation?.situationType,
      scenarioFlavorId: a.flavor?.id,
      ...overrides,
    }),
  };
}

describe("SeedsReport", () => {
  const slots = planSeedSlots(options);
  const seeds = slots.map(slot => seedOf(slot));

  it("finds no difference when every seed carries its slot's values", () => {
    const report = SeedsReport.build(seeds, options);
    expect(report.seeds).toBe(12);
    expect(report.plannedSlots).toBe(12);
    expect(report.differences).toEqual([]);
    expect(report.values.every(v => v.planned === v.obtained)).toBe(true);
    expect(report.values.every(v => v.maxRiskGap === 0)).toBe(true);
    expect(report.situations.every(s => s.planned === s.obtained)).toBe(true);
    expect(report.forbidden).toEqual({
      motivationUse: 0,
      situationUse: 0,
      situationSignal: 0,
    });
    expect(SeedsReport.format(report, "seeds.jsonl")).toContain(
      "**Every seed carries the values of its planned slot**"
    );
  });

  it("counts a seed whose value moved, and a seed on the wrong side of the split", () => {
    const first = slots[0]!;
    const other = first.assignment.use === "homework" ? "learning" : "homework";
    const moved = [
      seedOf(first, {use: other}),
      {...seedOf(slots[1]!), isPrivate: !slots[1]!.isPrivate},
      ...slots.slice(2).map(slot => seedOf(slot)),
    ];
    const report = SeedsReport.build(moved, options);
    expect(report.differences).toEqual([
      {riskId: privacy.risk.id, missing: 2, extra: 2},
    ]);
    const use = report.values.filter(v => v.dimension === "use");
    expect(use.find(v => v.value === other)!.maxRiskGap).toBe(1);
    expect(SeedsReport.format(report, "seeds.jsonl")).toContain(
      "**2 seed(s) differ from the plan**"
    );
  });

  it("refuses to plan without a random seed", () => {
    expect(() =>
      SeedsReport.build(seeds, {totalSeeds: 12, riskIds: options.riskIds})
    ).toThrow("randomSeed");
  });
});
