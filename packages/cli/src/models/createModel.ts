import {ModelOptions} from "./_shared.js";
import {createFallbackModel} from "./fallbackModel.js";
import {createGatewayModel} from "./gatewayModel.js";
import {Model} from "./model.js";
import {
  isOpenAICompatibleConfig,
  tryResolveModelConfig,
} from "./modelConfig.js";
import {createOpenAICompatibleModelFromConfig, createOpenAICompatibleModelFromSlug} from "./openAICompatibleModel.js";
import {
  listOpenAICompatibleProviders,
  parseProviderSlug,
} from "./openAICompatibleProviders.js";

/**
 * Resolution order for a model slug:
 *
 * 1. Slug is a key in `models.json` → use that entry. If the entry has
 *    `provider: "openai-compatible"`, build the OpenAI-compatible model;
 *    otherwise build the gateway model (default behaviour).
 * 2. Slug looks like `<provider-prefix>/<model-id>` and the prefix is in the
 *    built-in OpenAI-compatible registry → build directly from env vars.
 * 3. Otherwise fall through to `createGatewayModel`, which will throw with
 *    the registry's "Unknown model" error (preserves existing UX for typos).
 */
export function createModel(
  modelsJsonPath: string,
  slug: string,
  options?: ModelOptions
): Model {
  const config = tryResolveModelConfig(modelsJsonPath, slug);
  if (config) {
    if (isOpenAICompatibleConfig(config)) {
      return createOpenAICompatibleModelFromConfig(slug, config, options);
    }
    return createGatewayModel(modelsJsonPath, slug, options);
  }

  const parsed = parseProviderSlug(slug);
  if (parsed) {
    return createOpenAICompatibleModelFromSlug(slug, parsed, options);
  }

  // Let the gateway path produce its registry-aware error message.
  return createGatewayModel(modelsJsonPath, slug, options);
}

export function createModelChain(
  modelsJsonPath: string,
  slugs: readonly string[],
  options?: ModelOptions
): Model {
  if (slugs.length === 0) {
    throw new Error("createModelChain: at least one slug required.");
  }
  return createFallbackModel(
    slugs.map(slug => ({
      label: slug,
      model: createModel(modelsJsonPath, slug, options),
    }))
  );
}

/**
 * Returns the printable list of provider prefixes available for the
 * `<prefix>/<model-id>` slug form. Used in error messages and `--help` output.
 */
export function listKnownProviderPrefixes(): readonly string[] {
  return listOpenAICompatibleProviders().map(p => p.prefix);
}
