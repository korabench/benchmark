import {describe, expect, it} from "vitest";
import {BehaviorSet} from "../behaviorSet.js";
import {RiskTaxonomy} from "../riskTaxonomy.js";
import {makeTaxonomy} from "./fixtures.js";

function taxonomyWith(categories: unknown) {
  return {id: "test", version: "1", categories};
}

function risk(id: string, extra: Record<string, unknown> = {}) {
  return {id, name: id, description: "d", conversationLength: 3, ...extra};
}

describe("RiskTaxonomy.parse", () => {
  it("accepts a well-formed taxonomy", () => {
    expect(RiskTaxonomy.allRisks(makeTaxonomy())).toHaveLength(2);
  });

  it("rejects an empty taxonomy", () => {
    expect(() => RiskTaxonomy.parse(taxonomyWith([]))).toThrow(
      /no risk categories/
    );
  });

  it("rejects duplicate category ids", () => {
    expect(() =>
      RiskTaxonomy.parse(
        taxonomyWith([
          {id: "same", name: "A", risks: [risk("a")]},
          {id: "same", name: "B", risks: [risk("b")]},
        ])
      )
    ).toThrow(/duplicate risk category ids: same/);
  });

  // Global, not per-category: findAnyRisk and every --risk-ids filter look risk
  // ids up across the whole taxonomy.
  it("rejects a risk id reused across categories", () => {
    expect(() =>
      RiskTaxonomy.parse(
        taxonomyWith([
          {id: "cat_a", name: "A", risks: [risk("shared")]},
          {id: "cat_b", name: "B", risks: [risk("shared")]},
        ])
      )
    ).toThrow(/duplicate risk ids: shared/);
  });

  it("rejects ids containing the scenario-key delimiter", () => {
    expect(() =>
      RiskTaxonomy.parse(
        taxonomyWith([{id: "cat:one", name: "A", risks: [risk("a")]}])
      )
    ).toThrow(/reserved as the scenario-key delimiter/);
  });

  it("rejects flavors whose proportions do not sum to one", () => {
    expect(() =>
      RiskTaxonomy.parse(
        taxonomyWith([
          {
            id: "cat_a",
            name: "A",
            risks: [
              risk("a", {
                scenarioFlavors: [
                  {id: "x", proportion: 0.3, description: "d"},
                  {id: "y", proportion: 0.3, description: "d"},
                ],
              }),
            ],
          },
        ])
      )
    ).toThrow(/proportions sum to/);
  });
});

describe("BehaviorSet.parse", () => {
  it("rejects an empty set", () => {
    expect(() =>
      BehaviorSet.parse({id: "t", version: "1", behaviors: []})
    ).toThrow(/no behaviors/);
  });

  it("rejects duplicate behavior ids", () => {
    const behavior = {
      id: "same",
      name: "n",
      level: "conversation",
      assessmentPrompt: "p",
    };
    expect(() =>
      BehaviorSet.parse({
        id: "t",
        version: "1",
        behaviors: [behavior, behavior],
      })
    ).toThrow(/duplicate behavior ids: same/);
  });
});
