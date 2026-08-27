import * as v from "valibot";

//
// Runtime model.
//

const VPackRef = v.object({
  id: v.string(),
  version: v.string(),
  /** Content fingerprint, so a silently-edited pack is still detectable. */
  hash: v.string(),
});

/**
 * Provenance for the taxonomy + behavior set a record was produced under.
 * Always optional on persisted shapes: records written before packs existed
 * carry no stamp and must keep parsing.
 */
const VPackStamp = v.object({
  taxonomy: VPackRef,
  behaviors: VPackRef,
});

//
// API.
//

function refToString(ref: PackRef): string {
  return `${ref.id}@${ref.version} (${ref.hash})`;
}

function equals(a: PackStamp, b: PackStamp): boolean {
  return (
    a.taxonomy.hash === b.taxonomy.hash && a.behaviors.hash === b.behaviors.hash
  );
}

//
// Exports.
//

export interface PackRef extends v.InferOutput<typeof VPackRef> {}
export interface PackStamp extends v.InferOutput<typeof VPackStamp> {}

export const PackRef = {
  io: VPackRef,
  toString: refToString,
};

export const PackStamp = {
  io: VPackStamp,
  equals,
};
