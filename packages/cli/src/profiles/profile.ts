import {ModelSpec, PackId, stableJson} from "@korabench/benchmark";
import {Hash} from "@korabench/core";
import * as R from "remeda";
import * as v from "valibot";

//
// Runtime model.
//
// An evaluation profile pins the LLM used for every role of the pipeline.
// Configs are inline (not slugs into models.json) so a profile file is a
// complete, self-describing record of what ran. The target model is never part
// of a profile: it is the subject of the evaluation, not the harness.
//

const VChain = v.pipe(v.array(ModelSpec.io), v.minLength(1));

const VProfileRoles = v.strictObject({
  /** Seed generation (`generate-seeds`). Fallback chain. */
  seeds: VChain,
  /** Scenario expansion and validation (`expand-scenarios`). Fallback chain. */
  expansion: VChain,
  /** First user message during expansion. Fallback chain. */
  expansionUser: VChain,
  /** User simulator during `run` (and `reassess` label). */
  user: ModelSpec.io,
  /** Concurrent judges (`run`, `reassess`, `continue`). Odd count. */
  judges: VChain,
  /** User simulator during `continue`; falls back to `user`. */
  continueUser: v.optional(ModelSpec.io),
});

const VProfile = v.strictObject({
  id: PackId.io,
  version: v.pipe(v.string(), v.minLength(1)),
  /** `computeHash()` of the rest of the file; guarded by a test in CI. */
  hash: v.string(),
  roles: VProfileRoles,
});

const ROLE_LIST = [
  "seeds",
  "expansion",
  "expansionUser",
  "user",
  "judges",
  "continueUser",
] as const;

export const ODD_JUDGES_MESSAGE =
  "The current implementation only supports odd numbers of judges. This ensures that the median assessment is always defined. See `aggregateTestAssessments` for reference.";

//
// API.
//

function computeHash(
  profile: Pick<Profile, "id" | "version" | "roles">
): string {
  return Hash.shortHash(
    stableJson({
      id: profile.id,
      version: profile.version,
      roles: profile.roles,
    })
  );
}

function label(profile: Pick<Profile, "id" | "version">): string {
  return `${profile.id}@${profile.version}`;
}

function specsOf(roles: ProfileRoles, role: Role): readonly ModelSpec[] {
  const value = roles[role];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function assertUniqueNames(roles: ProfileRoles): void {
  ROLE_LIST.forEach(role => {
    const names = specsOf(roles, role).map(spec => spec.name);
    const duplicates = R.pipe(
      names,
      R.groupBy(R.identity()),
      R.pickBy(group => group.length > 1),
      R.keys()
    );
    if (duplicates.length > 0) {
      throw new Error(
        `Profile role "${role}" lists the same model name more than once: ${duplicates.join(", ")}.`
      );
    }
  });
}

/** Structural checks shared by file profiles and override-derived ones. */
function assertValidRoles(roles: ProfileRoles): void {
  if (roles.judges.length % 2 === 0) {
    throw new Error(ODD_JUDGES_MESSAGE);
  }
  assertUniqueNames(roles);
}

export interface ParseOptions {
  /** Refuse a profile whose declared `hash` does not match its content. */
  verifyHash: boolean;
}

function parse(data: unknown, options: ParseOptions): Profile {
  const profile = v.parse(VProfile, data);
  assertValidRoles(profile.roles);
  if (options.verifyHash) {
    const expected = computeHash(profile);
    if (profile.hash !== expected) {
      throw new Error(
        `Profile "${label(profile)}" declares hash "${profile.hash}" but its content hashes to "${expected}". ` +
          `Bump "version" and set "hash" to "${expected}" ` +
          `(\`yarn kora --profile <spec> profile --print-hash\` prints it).`
      );
    }
  }
  return profile;
}

/** Every role filled in: `continueUser` defaults to `user`. */
function effectiveRoles(roles: ProfileRoles): EffectiveRoles {
  return {
    ...roles,
    continueUser: roles.continueUser ?? roles.user,
  };
}

//
// Exports.
//

export type Role = (typeof ROLE_LIST)[number];

export interface ProfileRoles extends v.InferOutput<typeof VProfileRoles> {}

/** `ProfileRoles` with every optional role resolved. */
export type EffectiveRoles = Required<ProfileRoles>;

export interface Profile extends v.InferOutput<typeof VProfile> {}

export const Role = {
  list: ROLE_LIST,
  specsOf,
};

export const Profile = {
  io: VProfile,
  parse,
  computeHash,
  label,
  effectiveRoles,
  assertValidRoles,
};
