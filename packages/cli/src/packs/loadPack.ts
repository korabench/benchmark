import {BehaviorSet, Packs, RiskTaxonomy} from "@korabench/benchmark";
import {readFileSync} from "node:fs";
import * as path from "node:path";

//
// Pack specs.
//
// A spec is either a registered pack name ("kora") or a path to a JSON file.
// Anything that looks like a path is treated as one; pack ids may not contain a
// path separator or end in ".json", so the two never overlap.
//

const BUNDLED_NAME = "kora";

function isPath(spec: string): boolean {
  return (
    spec.endsWith(".json") || spec.includes("/") || spec.includes(path.sep)
  );
}

function readJson(spec: string, what: string): unknown {
  const filePath = path.resolve(process.cwd(), spec);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Could not read ${what} pack from ${filePath}: ${(error as Error).message}`,
      {cause: error}
    );
  }
}

function assertKnownName(spec: string, what: string): void {
  if (spec !== BUNDLED_NAME) {
    throw new Error(
      `Unknown ${what} pack "${spec}". Known packs: ${BUNDLED_NAME}. ` +
        `Pass a path to a JSON file to use a custom pack.`
    );
  }
}

//
// API.
//

export function resolveTaxonomy(spec: string): RiskTaxonomy {
  if (!isPath(spec)) {
    assertKnownName(spec, "taxonomy");
    return Packs.bundled().taxonomy;
  }
  // A custom taxonomy must be the full {id, version, categories} envelope — no
  // sniffing for the bare-array shape the bundled data file happens to use.
  return RiskTaxonomy.parse(readJson(spec, "taxonomy"));
}

export function resolveBehaviors(spec: string): BehaviorSet {
  if (!isPath(spec)) {
    assertKnownName(spec, "behavior");
    return Packs.bundled().behaviors;
  }
  return BehaviorSet.parse(readJson(spec, "behavior"));
}

export interface PackOptions {
  taxonomy?: string;
  behaviors?: string;
}

/** Resolve --taxonomy / --behaviors and make them the process-wide packs. */
export function configurePacks(options: PackOptions): void {
  Packs.configure({
    taxonomy: options.taxonomy ? resolveTaxonomy(options.taxonomy) : undefined,
    behaviors: options.behaviors
      ? resolveBehaviors(options.behaviors)
      : undefined,
  });
}
