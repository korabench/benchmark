import {Program} from "../cli.js";
import {resolveEffectiveProfile} from "../profiles/effectiveProfile.js";
import {loadProfile, profilesDir} from "../profiles/loadProfile.js";
import {checkProfileModels, printProfile} from "../profiles/printProfile.js";
import {Profile} from "../profiles/profile.js";
import {Profiles} from "../profiles/profiles.js";

//
// Command.
//

export interface ProfileCommandOptions {
  /** Call every model once and report what the provider served. */
  check?: boolean;
  /** Print only the recomputed hash, even when the file's hash is stale. */
  printHash?: boolean;
}

export async function profileCommand(
  _program: Program,
  modelsJsonPath: string,
  spec: string,
  options: ProfileCommandOptions = {}
) {
  const dir = profilesDir(modelsJsonPath);

  if (options.printHash) {
    const {profile} = loadProfile(spec, dir, {verifyHash: false});
    console.log(Profile.computeHash(profile));
    return;
  }

  Profiles.configure(loadProfile(spec, dir));
  const effective = resolveEffectiveProfile(modelsJsonPath);
  printProfile(effective, Profiles.current().path);

  if (options.check) {
    console.log("");
    const ok = await checkProfileModels(effective);
    if (!ok) {
      process.exitCode = 1;
    }
  }
}
