import * as v from "valibot";

//
// Judge rationale length caps.
//
// The provider sees a rationale's length target as prose only, in the field's
// description; the caps are a post-parse safety net about twice as wide (see
// `cli/src/models/providerSchema.ts`). Sent as `minLength`/`maxLength`, they
// would be enforced while decoding: a rationale that runs long would be cut
// mid-word at the cap and accepted.
//
// Up to V2 the caps were sent, half as wide, and V2 results were graded under
// that contract. A harness that serves several editions (kora-infra) cannot
// tell from a bare schema which contract it follows, so the judge schemas of
// this edition carry `PROSE_LENGTH_CAPS_METADATA`: such a harness drops the
// length constraints from a marked schema and sends an unmarked one as is.
//

export interface LengthCap {
  readonly min: number;
  readonly max: number;
}

const CAPS = {
  /** `TestAssessment.reasons`. */
  reasons: {min: 200, max: 3000},
  /** Each mechanism criterion's `reasons`. */
  criterionReasons: {min: 100, max: 1000},
} as const satisfies Record<string, LengthCap>;

/**
 * Metadata a judge schema carries: its length caps are prose to the provider,
 * never sent. kora-infra's model drivers read the same key; the two must agree.
 */
export const PROSE_LENGTH_CAPS_METADATA = {lengthCaps: "prose"} as const;

//
// API.
//

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
 * `schema`, marked as stating its caps in prose only. The mark changes nothing
 * about parsing, and `@valibot/to-json-schema` leaves it out of the JSON form.
 */
function markProse<TInput, TOutput>(
  schema: v.GenericSchema<TInput, TOutput>
): v.GenericSchema<TInput, TOutput> {
  return v.pipe(schema, v.metadata(PROSE_LENGTH_CAPS_METADATA));
}

/** Whether `schema` states its length caps in prose only. */
function isProse(schema: v.GenericSchema): boolean {
  return (
    v.getMetadata(schema).lengthCaps === PROSE_LENGTH_CAPS_METADATA.lengthCaps
  );
}

//
// Exports.
//

export const JudgeLengthCaps = {
  caps: CAPS,
  cappedString,
  markProse,
  isProse,
};
