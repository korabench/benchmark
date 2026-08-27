import {CustomError} from "@korabench/core";
import * as R from "remeda";
import {Packs} from "./packs.js";
import {RiskTaxonomy} from "./riskTaxonomy.js";

//
// Runtime model.
//

export type RiskRefIssueKind =
  | "unknown_risk_category"
  | "unknown_risk"
  | "risk_not_in_category"
  | "unknown_flavor";

export interface RiskRef {
  riskCategoryId: string;
  riskId: string;
  scenarioFlavorId?: string;
}

export interface RiskRefIssue {
  /** 1-based line number in the source file, or index in an in-memory list. */
  lineNumber: number;
  recordId?: string;
  kind: RiskRefIssueKind;
  riskCategoryId: string;
  riskId: string;
  detail: string;
}

/** How many issues an error message lists before summarizing the rest. */
const MAX_LISTED_ISSUES = 20;

//
// Suggestions.
//
// Risk ids are hand-authored snake_case, so a single typo is by far the most
// likely cause of a miss. One edit of distance is enough to catch it and cheap
// over a few dozen candidates.
//

function isWithinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) {
      return false;
    }
    if (shorter.length === longer.length) {
      i++;
    }
    j++;
  }
  return edits + (longer.length - j) <= 1;
}

function suggest(value: string, candidates: readonly string[]): string {
  const match = candidates.find(c => isWithinOneEdit(value, c));
  return match ? ` (did you mean "${match}"?)` : "";
}

//
// API.
//

/**
 * Check one risk reference against a taxonomy. Returns `undefined` when the
 * reference resolves cleanly.
 */
function checkRiskRef(
  ref: RiskRef,
  taxonomy: RiskTaxonomy = Packs.current().taxonomy
): Omit<RiskRefIssue, "lineNumber" | "recordId"> | undefined {
  const base = {riskCategoryId: ref.riskCategoryId, riskId: ref.riskId};
  const category = taxonomy.categories.find(c => c.id === ref.riskCategoryId);

  if (!category) {
    const known = taxonomy.categories.map(c => c.id);
    return {
      ...base,
      kind: "unknown_risk_category",
      detail: `riskCategoryId "${ref.riskCategoryId}" is not in the taxonomy${suggest(ref.riskCategoryId, known)}`,
    };
  }

  const risk = category.risks.find(r => r.id === ref.riskId);
  if (!risk) {
    // Distinguish "typo" from "right risk, wrong category" — the second is a
    // genuinely different mistake and used to surface only mid-run.
    const elsewhere = RiskTaxonomy.allRisks(taxonomy).find(
      r => r.id === ref.riskId
    );
    if (elsewhere) {
      return {
        ...base,
        kind: "risk_not_in_category",
        detail: `riskId "${ref.riskId}" exists but not under category "${ref.riskCategoryId}"`,
      };
    }
    const known = RiskTaxonomy.allRisks(taxonomy).map(r => r.id);
    return {
      ...base,
      kind: "unknown_risk",
      detail: `riskId "${ref.riskId}" is not in the taxonomy${suggest(ref.riskId, known)}`,
    };
  }

  if (ref.scenarioFlavorId !== undefined) {
    const flavors = risk.scenarioFlavors ?? [];
    if (!flavors.some(f => f.id === ref.scenarioFlavorId)) {
      return {
        ...base,
        kind: "unknown_flavor",
        detail: `scenarioFlavorId "${ref.scenarioFlavorId}" is not defined on risk "${ref.riskId}"`,
      };
    }
  }

  return undefined;
}

function formatIssues(
  issues: readonly RiskRefIssue[],
  source: string,
  taxonomy: RiskTaxonomy
): string {
  const listed = issues
    .slice(0, MAX_LISTED_ISSUES)
    .map(i => `  line ${i.lineNumber}  ${i.detail}`);
  const omitted = issues.length - listed.length;

  return [
    `${issues.length} record(s) in ${source} reference risks absent from taxonomy "${RiskTaxonomy.label(taxonomy)}":`,
    "",
    ...listed,
    ...(omitted > 0 ? [`  …and ${omitted} more.`] : []),
    "",
    `Known category ids: ${taxonomy.categories.map(c => c.id).join(", ")}`,
  ].join("\n");
}

/** Throw when any reference fails to resolve. No-op otherwise. */
function assertConforms(
  issues: readonly RiskRefIssue[],
  source: string,
  taxonomy: RiskTaxonomy = Packs.current().taxonomy
): void {
  if (issues.length > 0) {
    throw new TaxonomyConformanceError(
      formatIssues(issues, source, taxonomy),
      issues
    );
  }
}

/**
 * Validate explicit risk ids (a `--risk-ids` filter) against the taxonomy, so a
 * typo fails loudly instead of silently matching zero scenarios.
 */
function assertRiskIdsKnown(
  riskIds: readonly string[],
  taxonomy: RiskTaxonomy = Packs.current().taxonomy
): void {
  const known = RiskTaxonomy.allRisks(taxonomy).map(r => r.id);
  const knownSet = new Set(known);
  const unknown = R.unique(riskIds.filter(id => !knownSet.has(id)));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown risk IDs for taxonomy "${RiskTaxonomy.label(taxonomy)}": ` +
        unknown.map(id => `${id}${suggest(id, known)}`).join(", ")
    );
  }
}

//
// Exports.
//

export class TaxonomyConformanceError extends CustomError {
  declare readonly issues: readonly RiskRefIssue[];

  constructor(message: string, issues: readonly RiskRefIssue[]) {
    super(message);
    // Non-enumerable on purpose: an uncaught error prints its own enumerable
    // properties, and a few hundred issue objects would bury the message we
    // just formatted. Still readable programmatically.
    Object.defineProperty(this, "issues", {value: issues, enumerable: false});
  }
}

export const Conformance = {
  checkRiskRef,
  assertConforms,
  assertRiskIdsKnown,
  formatIssues,
  maxListedIssues: MAX_LISTED_ISSUES,
};
