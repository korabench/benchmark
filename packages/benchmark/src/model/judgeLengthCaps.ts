import * as v from "valibot";
import {Packs} from "../packs/packs.js";

//
// Judge rationale length caps.
//
// Up to taxonomy version 2 the caps were part of the provider contract: sent
// as `minLength`/`maxLength` and enforced while decoding, so a rationale that
// ran long was cut at the cap and accepted. From version 3 the provider sees
// the length target as prose only, and the caps are a post-parse safety net
// twice as wide (see `cli/src/models/providerSchema.ts`).
//
// A run pinned to an earlier taxonomy keeps the old contract. kora-infra adds
// models and apps to its published V2 runs after the fact, and their judge
// requests must stay byte-identical to the ones that graded the rest of the
// run; otherwise the new rows are graded under a different contract than the
// rows they are compared with.
//

/** First taxonomy version whose judge schemas carry no provider-side cap. */
const UNCAPPED_FROM_TAXONOMY_VERSION = 3;

export interface LengthCap {
  readonly min: number;
  readonly max: number;
}

export interface JudgeLengthCaps {
  /** `TestAssessment.reasons`. */
  readonly reasons: LengthCap;
  /** Each mechanism criterion's `reasons`. */
  readonly criterionReasons: LengthCap;
  /** Whether the provider is asked to enforce the caps while decoding. */
  readonly enforcedByProvider: boolean;
}

const LEGACY: JudgeLengthCaps = {
  reasons: {min: 200, max: 1500},
  criterionReasons: {min: 100, max: 500},
  enforcedByProvider: true,
};

const CURRENT: JudgeLengthCaps = {
  reasons: {min: 200, max: 3000},
  criterionReasons: {min: 100, max: 1000},
  enforcedByProvider: false,
};

/**
 * Metadata a schema carries when its length caps belong to the provider
 * contract. A harness reads it with `v.getMetadata()` before converting the
 * schema and keeps `minLength`/`maxLength` in that case. kora-infra's model
 * drivers read the same key; the two must agree.
 */
export const PROVIDER_LENGTH_CAPS_METADATA = {lengthCaps: "provider"} as const;

//
// API.
//

function isLegacyTaxonomy(version: string): boolean {
  // Versions are "1", "1.1", "2", "3"; anything unparseable is current.
  return Number.parseFloat(version) < UNCAPPED_FROM_TAXONOMY_VERSION;
}

/** The caps the active taxonomy asks for. */
function forActiveTaxonomy(): JudgeLengthCaps {
  return isLegacyTaxonomy(Packs.current().taxonomy.version) ? LEGACY : CURRENT;
}

/** A string field capped by `cap`, described by `description`. */
function cappedString(cap: LengthCap, description: string) {
  return v.pipe(
    v.string(),
    v.minLength(cap.min),
    v.maxLength(cap.max),
    v.description(description)
  );
}

/**
 * `schema`, marked for the provider to enforce its caps when `caps` says so.
 * The mark changes nothing about parsing, and `@valibot/to-json-schema` leaves
 * it out of the JSON form.
 */
function markForProvider<TInput, TOutput>(
  schema: v.GenericSchema<TInput, TOutput>,
  caps: JudgeLengthCaps
): v.GenericSchema<TInput, TOutput> {
  return caps.enforcedByProvider
    ? v.pipe(schema, v.metadata(PROVIDER_LENGTH_CAPS_METADATA))
    : schema;
}

/** Whether `schema` asks the provider to enforce its length caps. */
function enforcedByProvider(schema: v.GenericSchema): boolean {
  return (
    v.getMetadata(schema).lengthCaps ===
    PROVIDER_LENGTH_CAPS_METADATA.lengthCaps
  );
}

//
// Exports.
//

export const JudgeLengthCaps = {
  forActiveTaxonomy,
  /** The two contracts, for typing and tests; runs read `forActiveTaxonomy`. */
  legacyContract: LEGACY,
  currentContract: CURRENT,
  cappedString,
  markForProvider,
  enforcedByProvider,
};
