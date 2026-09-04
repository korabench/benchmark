import * as R from "remeda";
import * as v from "valibot";

//
// Runtime model.
//

/**
 * Provider options are JSON, typed as such rather than `unknown`: a stamp is
 * persisted and served to browsers, and serialization-aware frameworks reject
 * `unknown` where they accept a JSON value. Two levels of nesting cover every
 * provider option in use (e.g. `deepseek.thinking = {type: "enabled"}`) without
 * a recursive type, which those same frameworks fail to instantiate.
 */
const VJsonLeaf = v.union([v.string(), v.number(), v.boolean(), v.null()]);

const VProviderOption = v.union([
  VJsonLeaf,
  v.array(VJsonLeaf),
  v.record(v.string(), VJsonLeaf),
]);

/**
 * A fully resolved LLM configuration plus a display `name`.
 *
 * `name` is what the CLI prints and what result headers persist in their
 * `judges` / `user` fields (historically a `models.json` slug). Everything
 * else is the configuration the gateway actually uses, so a spec is
 * self-describing: no registry lookup is needed to know what ran.
 */
const VModelSpec = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  model: v.string(),
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  providerOptions: v.optional(
    v.record(v.string(), v.record(v.string(), VProviderOption))
  ),
});

//
// API.
//

function config(spec: ModelSpec): ModelConfig {
  return R.omit(spec, ["name"]);
}

function fromConfig(name: string, config: ModelConfig): ModelSpec {
  return {name, ...config};
}

//
// Exports.
//

export interface ModelSpec extends v.InferOutput<typeof VModelSpec> {}

/** A `ModelSpec` without its display name: the gateway-facing part. */
export type ModelConfig = Omit<ModelSpec, "name">;

export const ModelSpec = {
  io: VModelSpec,
  config,
  fromConfig,
};
