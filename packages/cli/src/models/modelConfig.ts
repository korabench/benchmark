import {memoize} from "@korabench/core";
import * as fs from "node:fs";
import * as v from "valibot";

//
// Runtime model.
//

const VBaseModelConfig = v.object({
  model: v.string(),
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  providerOptions: v.optional(
    v.record(v.string(), v.record(v.string(), v.unknown()))
  ),
});

const VGatewayModelConfig = v.object({
  ...VBaseModelConfig.entries,
  provider: v.optional(v.literal("gateway")),
});

// For "openai-compatible" provider, exactly one of baseURL/baseURLEnv must be
// set, and exactly one of apiKey/apiKeyEnv must be set. Validated below in
// `validateOpenAICompatibleConfig`.
const VOpenAICompatibleModelConfig = v.object({
  ...VBaseModelConfig.entries,
  provider: v.literal("openai-compatible"),
  baseURL: v.optional(v.string()),
  baseURLEnv: v.optional(v.string()),
  apiKey: v.optional(v.string()),
  apiKeyEnv: v.optional(v.string()),
  supportsStructuredOutputs: v.optional(v.boolean()),
});

const VModelConfig = v.union([
  VOpenAICompatibleModelConfig,
  VGatewayModelConfig,
]);

const VModelRegistry = v.record(v.string(), VModelConfig);

//
// API.
//

export type ModelConfig = v.InferOutput<typeof VModelConfig>;
export type GatewayModelConfig = v.InferOutput<typeof VGatewayModelConfig>;
export type OpenAICompatibleModelConfig = v.InferOutput<
  typeof VOpenAICompatibleModelConfig
>;

export function isOpenAICompatibleConfig(
  config: ModelConfig
): config is OpenAICompatibleModelConfig {
  return config.provider === "openai-compatible";
}

function validateOpenAICompatibleConfig(
  name: string,
  config: OpenAICompatibleModelConfig
): void {
  const hasBaseURL = config.baseURL !== undefined;
  const hasBaseURLEnv = config.baseURLEnv !== undefined;
  if (hasBaseURL === hasBaseURLEnv) {
    throw new Error(
      `Model "${name}": exactly one of "baseURL" or "baseURLEnv" must be set ` +
        `(found ${hasBaseURL && hasBaseURLEnv ? "both" : "neither"}).`
    );
  }

  const hasApiKey = config.apiKey !== undefined;
  const hasApiKeyEnv = config.apiKeyEnv !== undefined;
  if (hasApiKey === hasApiKeyEnv) {
    throw new Error(
      `Model "${name}": exactly one of "apiKey" or "apiKeyEnv" must be set ` +
        `(found ${hasApiKey && hasApiKeyEnv ? "both" : "neither"}).`
    );
  }
}

export const loadModelRegistry = memoize(
  (modelsJsonPath: string): Record<string, ModelConfig> => {
    const raw = fs.readFileSync(modelsJsonPath, "utf-8");
    const parsed = v.parse(VModelRegistry, JSON.parse(raw));
    for (const [name, config] of Object.entries(parsed)) {
      if (isOpenAICompatibleConfig(config)) {
        validateOpenAICompatibleConfig(name, config);
      }
    }
    return parsed;
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

export function tryResolveModelConfig(
  modelsJsonPath: string,
  name: string
): ModelConfig | undefined {
  return loadModelRegistry(modelsJsonPath)[name];
}
