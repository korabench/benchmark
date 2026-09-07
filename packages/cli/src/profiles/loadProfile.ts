import {existsSync, readdirSync, readFileSync} from "node:fs";
import * as path from "node:path";
import {Profile} from "./profile.js";

//
// Profile specs.
//
// A spec is either a profile name ("kora", "judge-test.local") resolved inside
// the profiles directory, or a path to a JSON file. Anything that looks like a
// path is treated as one; profile ids may not contain a path separator or end
// in ".json", so the two never overlap.
//
// Local profiles (`*.local.json`) are gitignored scratch files for testing a
// model configuration. They skip the hash check: nobody is expected to keep a
// throwaway file's hash current.
//

const LOCAL_SUFFIX = ".local.json";

function isPath(spec: string): boolean {
  return (
    spec.endsWith(".json") || spec.includes("/") || spec.includes(path.sep)
  );
}

function isLocalPath(filePath: string): boolean {
  return filePath.endsWith(LOCAL_SUFFIX);
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Could not read profile from ${filePath}: ${(error as Error).message}`,
      {cause: error}
    );
  }
}

//
// API.
//

/** The profiles directory sits next to `models.json`. */
export function profilesDir(modelsJsonPath: string): string {
  return path.join(path.dirname(modelsJsonPath), "profiles");
}

/** Committed profile names in `dir` (local profiles excluded). */
export function listProfileNames(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => file.endsWith(".json") && !isLocalPath(file))
    .map(file => file.slice(0, -".json".length))
    .sort();
}

export interface LoadedProfile {
  profile: Profile;
  /** Loaded from a `*.local.json` file: uncommitted, hash unchecked. */
  local: boolean;
  path: string;
}

export interface LoadProfileOptions {
  /** Defaults to `true` for committed profiles and `false` for local ones. */
  verifyHash?: boolean;
}

export function loadProfile(
  spec: string,
  dir: string,
  options: LoadProfileOptions = {}
): LoadedProfile {
  const filePath = isPath(spec)
    ? path.resolve(process.cwd(), spec)
    : path.join(dir, `${spec}.json`);

  if (!isPath(spec) && !existsSync(filePath)) {
    const known = listProfileNames(dir);
    throw new Error(
      `Unknown profile "${spec}". Known profiles: ${known.length > 0 ? known.join(", ") : "(none)"} (in ${dir}). ` +
        `Pass a path to a JSON file, or a "<name>.local" profile stored as ${dir}/<name>${LOCAL_SUFFIX}.`
    );
  }

  const local = isLocalPath(filePath);
  const profile = Profile.parse(readJson(filePath), {
    verifyHash: options.verifyHash ?? !local,
  });
  return {profile, local, path: filePath};
}
