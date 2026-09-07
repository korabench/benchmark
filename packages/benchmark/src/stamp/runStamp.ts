import {Hash} from "@korabench/core";
import * as v from "valibot";
import {ModelSpec} from "../model/modelSpec.js";
import {PackStamp} from "../packs/packStamp.js";

//
// Runtime model.
//
// Provenance for everything that shaped a record: which evaluation profile
// (resolved model config per role), which prompt templates, which packs,
// which code revision, which input corpus. Written next to every persisted
// record and result header. Always optional on persisted shapes: records
// written before stamps existed carry none and must keep parsing.
//
// Schemas here are non-strict on purpose: a newer stamp nested inside a strict
// `TestResult` must still parse under older code.
//

const VProfileRef = v.object({
  id: v.string(),
  version: v.string(),
  /** Hash of the *effective* roles; differs from the file's when overridden. */
  hash: v.string(),
  /** Loaded from an uncommitted `*.local.json` file. */
  local: v.optional(v.boolean()),
  /** Roles replaced on the command line. */
  overrides: v.optional(v.array(v.string())),
});

const VRunnerTarget = v.object({
  kind: v.picklist(["web-runner", "native-runner", "custom"]),
  slug: v.string(),
});

const VTargetRef = v.union([ModelSpec.io, VRunnerTarget]);

const VChain = v.array(ModelSpec.io);

// A harness records the roles it has. The CLI fills every one; the kora-infra
// worker only simulates the user and judges, so the corpus-building roles are
// optional. `user` and `judges` are what every evaluation needs.
const VStampModels = v.object({
  seeds: v.optional(VChain),
  expansion: v.optional(VChain),
  expansionUser: v.optional(VChain),
  user: ModelSpec.io,
  judges: VChain,
  continueUser: v.optional(ModelSpec.io),
  /** The evaluated model; only meaningful for `run`. */
  target: v.optional(VTargetRef),
});

const VPromptsRef = v.object({
  version: v.string(),
  hash: v.string(),
});

const VCodeRef = v.object({
  /** `@korabench/cli` package version. */
  version: v.string(),
  commit: v.optional(v.string()),
  dirty: v.optional(v.boolean()),
});

const VInputRef = v.object({
  path: v.string(),
  sha256: v.string(),
});

const VRunStamp = v.object({
  profile: VProfileRef,
  models: VStampModels,
  prompts: VPromptsRef,
  code: VCodeRef,
  packs: PackStamp.io,
  input: v.optional(VInputRef),
  /** Conversation language (e.g. "Estonian"); absent means English. */
  language: v.optional(v.string()),
});

//
// API.
//

/**
 * Comparability key. Two records are comparable when their profile, prompt
 * templates, packs and conversation language match. Code revision and input corpus are recorded but
 * excluded: an unrelated commit must not refuse a resume, and prompt changes
 * are caught by `prompts.hash`.
 */
function hash(stamp: RunStamp): string {
  return Hash.shortHash(
    [
      stamp.profile.hash,
      stamp.prompts.hash,
      stamp.packs.taxonomy.hash,
      stamp.packs.behaviors.hash,
      stamp.language ?? "",
    ].join("|")
  );
}

function equals(a: RunStamp, b: RunStamp): boolean {
  return hash(a) === hash(b);
}

function describeProfile(ref: ProfileRef): string {
  const markers = [
    ref.local ? "local" : undefined,
    ref.overrides?.length ? `overrides: ${ref.overrides.join(",")}` : undefined,
  ].filter(marker => marker !== undefined);
  const suffix = markers.length > 0 ? ` [${markers.join("; ")}]` : "";
  return `${ref.id}@${ref.version} (${ref.hash})${suffix}`;
}

/** One line, for error messages and logs. */
function describe(stamp: RunStamp): string {
  const {taxonomy, behaviors} = stamp.packs;
  const language = stamp.language ? ` | language ${stamp.language}` : "";
  return (
    `profile ${describeProfile(stamp.profile)} | ` +
    `prompts ${stamp.prompts.version} (${stamp.prompts.hash}) | ` +
    `packs ${taxonomy.id}@${taxonomy.version} (${taxonomy.hash}) / ` +
    `${behaviors.id}@${behaviors.version} (${behaviors.hash})` +
    language
  );
}

//
// Exports.
//

export interface ProfileRef extends v.InferOutput<typeof VProfileRef> {}
export type TargetRef = v.InferOutput<typeof VTargetRef>;
export interface StampModels extends v.InferOutput<typeof VStampModels> {}
export interface RunStamp extends v.InferOutput<typeof VRunStamp> {}

export const RunStamp = {
  io: VRunStamp,
  hash,
  equals,
  describe,
  describeProfile,
};
