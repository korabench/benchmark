import {RunStamp, ScenarioPrompt} from "@korabench/benchmark";
import {EffectiveProfile} from "../../profiles/effectiveProfile.js";
import {ServedModels} from "../../profiles/roleModels.js";

//
// Result header.
//
// The fields written ahead of `scores` in every result JSON. `judges` / `user`
// keep their historical meaning (display names), `packs` stays for readers
// that predate stamps, and `stamp` is the full provenance.
//

export interface ResultHeaderArgs {
  target: string;
  effective: EffectiveProfile;
  prompts: readonly ScenarioPrompt[];
  stamp: RunStamp;
  /** Defaults to the profile's `user` role; `continue` passes `continueUser`. */
  userName?: string;
  served?: ServedModels;
}

export interface ResultHeader {
  target: string;
  judges: readonly string[];
  user: string;
  prompts: readonly ScenarioPrompt[];
  packs: RunStamp["packs"];
  stamp: RunStamp;
  served?: ServedModels;
}

export function buildResultHeader(args: ResultHeaderArgs): ResultHeader {
  const {target, effective, prompts, stamp, userName, served} = args;
  return {
    target,
    judges: effective.roles.judges.map(spec => spec.name),
    user: userName ?? effective.roles.user.name,
    prompts,
    packs: stamp.packs,
    stamp,
    ...(served ? {served} : {}),
  };
}
