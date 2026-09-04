import {ModelSpec} from "@korabench/benchmark";
import {createFallbackModel} from "../models/fallbackModel.js";
import {
  createGatewayModelFromConfig,
  GatewayModel,
  ModelOptions,
} from "../models/gatewayModel.js";
import {Model} from "../models/model.js";

//
// Models for profile roles.
//
// Every role of a profile is a list of `ModelSpec`s; these helpers turn them
// into the `Model` shapes the commands consume, keeping the spec `name` as the
// label used in logs and result headers.
//

export interface ChainMember {
  spec: ModelSpec;
  model: GatewayModel;
}

export interface ChainModel {
  /** Fallback chain over `members`, in order. */
  model: Model;
  members: readonly ChainMember[];
}

export function createSpecModel(
  spec: ModelSpec,
  options?: ModelOptions
): GatewayModel {
  return createGatewayModelFromConfig(
    ModelSpec.config(spec),
    spec.name,
    options
  );
}

export function createChainModel(
  specs: readonly ModelSpec[],
  options?: ModelOptions
): ChainModel {
  const members = specs.map(spec => ({
    spec,
    model: createSpecModel(spec, options),
  }));
  return {
    model: createFallbackModel(
      members.map(({spec, model}) => ({label: spec.name, model}))
    ),
    members,
  };
}

/** Judges keyed by spec name: the key is what `runJudges` reports per judge. */
export function createJudgeModels(
  specs: readonly ModelSpec[],
  options?: ModelOptions
): Record<string, GatewayModel> {
  return Object.fromEntries(
    specs.map(spec => [spec.name, createSpecModel(spec, options)])
  );
}

export function chainLabel(specs: readonly ModelSpec[]): string {
  return specs.map(spec => spec.name).join(" → ");
}

//
// Served model ids.
//

/** Provider-reported model ids per role, sorted, as written to results. */
export interface ServedModels {
  user?: readonly string[];
  judges: Record<string, readonly string[]>;
  target?: readonly string[];
}

export function servedOf(
  model: GatewayModel | undefined
): string[] | undefined {
  return model ? [...model.served].sort() : undefined;
}

export function collectServed(args: {
  user?: GatewayModel;
  judges: Record<string, GatewayModel>;
  target?: GatewayModel;
}): ServedModels {
  const user = servedOf(args.user);
  const target = servedOf(args.target);
  return {
    ...(user ? {user} : {}),
    judges: Object.fromEntries(
      Object.entries(args.judges).map(([name, model]) => [
        name,
        servedOf(model)!,
      ])
    ),
    ...(target ? {target} : {}),
  };
}
