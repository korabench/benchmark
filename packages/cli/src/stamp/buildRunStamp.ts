import {
  ModelSpec,
  Packs,
  Prompts,
  RunStamp,
  TargetRef,
} from "@korabench/benchmark";
import {resolveModelConfig} from "../models/modelConfig.js";
import {isNativeRunnerSlug} from "../models/nativeRunnerModel.js";
import {isWebRunnerSlug} from "../models/webRunnerModel.js";
import {EffectiveProfile} from "../profiles/effectiveProfile.js";
import {readPackageVersion} from "../shared/packageVersion.js";
import {sha256File} from "../shared/sha256File.js";
import {readGitInfo} from "./gitInfo.js";

//
// Stamp construction.
//

export interface BuildRunStampArgs {
  effective: EffectiveProfile;
  modelsJsonPath: string;
  /** Target slug for `run`; resolved to a spec or a runner reference. */
  target?: string;
  /** Input corpus, fingerprinted so results name what they were computed on. */
  inputPath?: string;
}

export function resolveTargetRef(
  modelsJsonPath: string,
  slug: string
): TargetRef {
  if (slug.startsWith("custom-")) return {kind: "custom", slug};
  if (isNativeRunnerSlug(slug)) return {kind: "native-runner", slug};
  if (isWebRunnerSlug(slug)) return {kind: "web-runner", slug};
  return ModelSpec.fromConfig(slug, resolveModelConfig(modelsJsonPath, slug));
}

export async function buildRunStamp(
  args: BuildRunStampArgs
): Promise<RunStamp> {
  const {effective, modelsJsonPath, target, inputPath} = args;
  const targetRef =
    target === undefined
      ? {}
      : {target: resolveTargetRef(modelsJsonPath, target)};
  const input =
    inputPath === undefined
      ? {}
      : {input: {path: inputPath, sha256: await sha256File(inputPath)}};

  return {
    profile: effective.ref,
    models: {...effective.roles, ...targetRef},
    prompts: Prompts.fingerprint(),
    code: {version: readPackageVersion(), ...readGitInfo()},
    packs: Packs.fingerprint(),
    ...input,
  };
}
