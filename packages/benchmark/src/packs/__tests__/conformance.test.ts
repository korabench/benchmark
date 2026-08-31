import {describe, expect, it} from "vitest";
import {Conformance, RiskRefIssue} from "../conformance.js";
import {RiskTaxonomy} from "../riskTaxonomy.js";
import {makeTaxonomy} from "./fixtures.js";

const taxonomy = makeTaxonomy();

function check(ref: {
  riskCategoryId: string;
  riskId: string;
  scenarioFlavorId?: string;
}) {
  return Conformance.checkRiskRef(ref, taxonomy);
}

describe("Conformance.checkRiskRef", () => {
  it("accepts a resolving reference", () => {
    expect(
      check({riskCategoryId: "cat_one", riskId: "risk_one"})
    ).toBeUndefined();
  });

  it("flags an unknown category", () => {
    const issue = check({riskCategoryId: "nope", riskId: "risk_one"});
    expect(issue?.kind).toBe("unknown_risk_category");
  });

  it("flags an unknown risk", () => {
    const issue = check({riskCategoryId: "cat_one", riskId: "nope"});
    expect(issue?.kind).toBe("unknown_risk");
  });

  // A real risk id under the wrong category is a different mistake from a typo,
  // and used to surface only mid-run via RiskCategory.findRisk.
  it("distinguishes a risk that exists under a different category", () => {
    const twoCategories = RiskTaxonomy.parse({
      id: "two",
      version: "1",
      categories: [
        {
          id: "cat_a",
          name: "A",
          risks: [
            {id: "risk_a", name: "a", description: "d", conversationLength: 3},
          ],
        },
        {
          id: "cat_b",
          name: "B",
          risks: [
            {id: "risk_b", name: "b", description: "d", conversationLength: 3},
          ],
        },
      ],
    });

    const issue = Conformance.checkRiskRef(
      {riskCategoryId: "cat_a", riskId: "risk_b"},
      twoCategories
    );
    expect(issue?.kind).toBe("risk_not_in_category");
    expect(issue?.detail).toContain('not under category "cat_a"');
  });

  it("flags an unknown scenario flavor", () => {
    const issue = check({
      riskCategoryId: "cat_one",
      riskId: "risk_one",
      scenarioFlavorId: "ghost",
    });
    expect(issue?.kind).toBe("unknown_flavor");
  });

  it("suggests a near-miss id", () => {
    const issue = check({riskCategoryId: "cat_one", riskId: "risk_onee"});
    expect(issue?.detail).toContain('did you mean "risk_one"?');
  });
});

describe("Conformance.assertConforms", () => {
  const issue = (lineNumber: number): RiskRefIssue => ({
    lineNumber,
    kind: "unknown_risk",
    riskCategoryId: "cat_one",
    riskId: "nope",
    detail: 'riskId "nope" is not in the taxonomy',
  });

  it("does nothing when there are no issues", () => {
    expect(() =>
      Conformance.assertConforms([], "file.jsonl", taxonomy)
    ).not.toThrow();
  });

  it("reports line numbers and the taxonomy label", () => {
    expect(() =>
      Conformance.assertConforms([issue(3)], "file.jsonl", taxonomy)
    ).toThrow(/line 3/);
    expect(() =>
      Conformance.assertConforms([issue(3)], "file.jsonl", taxonomy)
    ).toThrow(/taxonomy "test@1"/);
  });

  it("caps the listing and summarizes the rest", () => {
    const many = Array.from({length: Conformance.maxListedIssues + 5}, (_, i) =>
      issue(i + 1)
    );
    const message = Conformance.formatIssues(many, "file.jsonl", taxonomy);

    expect(message).toContain("…and 5 more.");
    expect(
      message.split("\n").filter(l => l.startsWith("  line "))
    ).toHaveLength(Conformance.maxListedIssues);
  });
});

describe("Conformance.assertRiskIdsKnown", () => {
  it("accepts known ids", () => {
    expect(() =>
      Conformance.assertRiskIdsKnown(["risk_one"], taxonomy)
    ).not.toThrow();
  });

  it("throws with a suggestion for an unknown id", () => {
    expect(() =>
      Conformance.assertRiskIdsKnown(["risk_onee"], taxonomy)
    ).toThrow(/risk_onee \(did you mean "risk_one"\?\)/);
  });
});
