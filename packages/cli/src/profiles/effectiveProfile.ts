import {ModelSpec} from "@korabench/benchmark";
import * as R from "remeda";
import {resolveModelConfig} from "../models/modelConfig.js";
import {EffectiveRoles, Profile, Role} from "./profile.js";
import {Profiles} from "./profiles.js";

//
// Effective profile.
//
// The configured profile, with any per-role CLI override applied. Overrides
// resolve registry slugs into inline specs, so the effective roles are as
// self-describing as a file profile. Any override changes the profile hash:
// results from an overridden run must never look comparable to results from
// the named profile.
//

export interface ProfileRef {
  id: string;
  version: string;
  hash: string;
  /** Loaded from an uncommitted `*.local.json` file. */
  local?: boolean;
  /** Roles replaced on the command line. */
  overrides?: Role[];
}

export interface EffectiveProfile {
  ref: ProfileRef;
  roles: EffectiveRoles;
}

/** Slugs given on the command line, per role. Single roles take one slug. */
export type RoleOverrides = Partial<Record<Role, readonly string[]>>;

const SINGLE_ROLES: ReadonlySet<Role> = new Set(["user", "continueUser"]);

function resolveSpecs(
  modelsJsonPath: string,
  slugs: readonly string[]
): ModelSpec[] {
  return slugs.map(slug =>
    ModelSpec.fromConfig(slug, resolveModelConfig(modelsJsonPath, slug))
  );
}

function applyOverride(
  roles: EffectiveRoles,
  role: Role,
  specs: readonly ModelSpec[]
): EffectiveRoles {
  if (SINGLE_ROLES.has(role)) {
    if (specs.length !== 1) {
      throw new Error(
        `Role "${role}" takes exactly one model, got ${specs.length}: ${specs.map(s => s.name).join(", ")}.`
      );
    }
    return {...roles, [role]: specs[0]!};
  }
  return {...roles, [role]: specs};
}

function warnOverride(
  ref: Pick<ProfileRef, "id" | "version">,
  role: Role,
  before: readonly ModelSpec[],
  after: readonly ModelSpec[]
): void {
  const names = (specs: readonly ModelSpec[]) =>
    specs.map(s => s.name).join(",");
  console.error(
    `WARNING: command-line ${role} overrides profile ${Profile.label(ref)} ` +
      `(${names(before)} -> ${names(after)}). Results will carry an ad-hoc profile hash.`
  );
}

export function resolveEffectiveProfile(
  modelsJsonPath: string,
  overrides: RoleOverrides = {}
): EffectiveProfile {
  const {profile, local} = Profiles.current();
  const base = Profile.effectiveRoles(profile.roles);

  const overridden = Role.list.filter(role => {
    const slugs = overrides[role];
    return slugs !== undefined && slugs.length > 0;
  });

  const roles = overridden.reduce((acc, role) => {
    const specs = resolveSpecs(modelsJsonPath, overrides[role]!);
    warnOverride(profile, role, Role.specsOf(acc, role), specs);
    return applyOverride(acc, role, specs);
  }, base);

  Profile.assertValidRoles(roles);

  const hash =
    overridden.length === 0
      ? profile.hash
      : Profile.computeHash({id: profile.id, version: profile.version, roles});

  const ref: ProfileRef = {
    id: profile.id,
    version: profile.version,
    hash,
    ...(local ? {local} : {}),
    ...(overridden.length > 0 ? {overrides: overridden} : {}),
  };

  return {ref, roles};
}

/** `id@version (hash)` plus local / override markers. */
export function describeProfileRef(ref: ProfileRef): string {
  const markers = R.pipe(
    [
      ref.local ? "local" : undefined,
      ref.overrides?.length
        ? `overrides: ${ref.overrides.join(",")}`
        : undefined,
    ],
    R.filter(R.isDefined)
  );
  const suffix = markers.length > 0 ? ` [${markers.join("; ")}]` : "";
  return `${Profile.label(ref)} (${ref.hash})${suffix}`;
}
