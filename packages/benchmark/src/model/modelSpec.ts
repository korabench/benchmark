import * as R from "remeda";
import * as v from "valibot";

//
// Runtime model.
//

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
    v.record(v.string(), v.record(v.string(), v.unknown()))
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
