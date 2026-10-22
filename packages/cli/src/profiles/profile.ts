// The profile model lives in the benchmark package so that every harness shares
// one schema and one hash formula; this module keeps the CLI's import paths.
export {
  Profile,
  Role,
  type EffectiveRoles,
  type ParseOptions,
  type ProfileRoles,
} from "@korabench/benchmark";
