import * as R from "remeda";
import * as v from "valibot";

//
// Runtime model.
//

// Pack, category, risk and behavior ids all flow into `ScenarioKey`, which is
// serialized as a colon-delimited string and split back apart on ":" (see
// `model/scenarioKey.ts`). An id containing ":" would silently produce an
// unparseable key, so the delimiter is excluded here rather than defended
// against at every split site.
const VPackId = v.pipe(
  v.string(),
  v.minLength(1),
  v.regex(
    /^[A-Za-z0-9._-]+$/,
    'Ids may only contain letters, digits, ".", "_" and "-" (":" is reserved as the scenario-key delimiter).'
  )
);

//
// API.
//

function assertUnique(
  ids: readonly string[],
  what: string,
  scope: string
): void {
  const duplicates = R.pipe(
    ids,
    R.groupBy(R.identity()),
    R.pickBy(group => group.length > 1),
    R.keys()
  );
  if (duplicates.length > 0) {
    throw new Error(
      `${scope} contains duplicate ${what} ids: ${duplicates.join(", ")}.`
    );
  }
}

//
// Exports.
//

export type PackId = v.InferOutput<typeof VPackId>;

export const PackId = {
  io: VPackId,
  assertUnique,
};
