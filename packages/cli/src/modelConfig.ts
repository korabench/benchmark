import {memoize} from "@korabench/core";
import * as fs from "node:fs";
import * as v from "valibot";

//
// Runtime model.
//

const VModelConfig = v.object({
  model: v.string(),
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  providerOptions: v.optional(
    v.record(v.string(), v.record(v.string(), v.unknown()))
  ),
});

const VModelRegistry = v.record(v.string(), VModelConfig);

//
// API.
//

export interface ModelConfig extends v.InferOutput<typeof VModelConfig> {}

export const loadModelRegistry = memoize(
  (modelsJsonPath: string): Record<string, ModelConfig> => {
    const raw = fs.readFileSync(modelsJsonPath, "utf-8");
    return v.parse(VModelRegistry, JSON.parse(raw));
  }
);

export function resolveModelConfig(
  modelsJsonPath: string,
  name: string
): ModelConfig {
  const registry = loadModelRegistry(modelsJsonPath);
  const config = registry[name];
  if (!config) {
    const available = Object.keys(registry).join(", ");
    throw new Error(`Unknown model "${name}". Available models: ${available}`);
  }
  return config;
}
