import {createOpenAICompatible} from "@ai-sdk/openai-compatible";
import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {generateObject, generateText, jsonSchema, LanguageModel} from "ai";
import {Agent, fetch as undiciFetch} from "undici";
import * as v from "valibot";
import {withRetry} from "../retry.js";
import {buildRetryOptions, extractJson, ModelOptions} from "./_shared.js";
import {Model} from "./model.js";
import {OpenAICompatibleModelConfig} from "./modelConfig.js";
import {
  OpenAICompatibleProvider,
  ParsedProviderSlug,
  resolveProviderConnection,
} from "./openAICompatibleProviders.js";

// Self-hosted models (vLLM, sglang, ...) running large/thinking models can take
// minutes per non-streaming completion, which trips undici's default header
// timeout. Use a generous dispatcher so kora can survive slow first responses
// and deep request queues.
const SLOW_MODEL_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const slowAgent = new Agent({
  headersTimeout: SLOW_MODEL_TIMEOUT_MS,
  bodyTimeout: SLOW_MODEL_TIMEOUT_MS,
  keepAliveTimeout: 60_000,
});
const slowFetch: typeof globalThis.fetch = (input, init) =>
  undiciFetch(input as any, {...(init as any), dispatcher: slowAgent}) as any;

interface ResolvedTarget {
  label: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  maxTokens: number | undefined;
  temperature: number | undefined;
  providerOptions: OpenAICompatibleModelConfig["providerOptions"];
  supportsStructuredOutputs: boolean;
}

function fromParsedSlug(
  parsed: ParsedProviderSlug,
  slug: string
): ResolvedTarget {
  const conn = resolveProviderConnection(parsed.provider);
  // Optional `<PREFIX>_MAX_TOKENS` cap. Useful for thinking/reasoning models
  // where unbounded generation can otherwise stall a benchmark.
  const maxTokensEnv = `${parsed.provider.prefix.toUpperCase()}_MAX_TOKENS`;
  const maxTokensRaw = process.env[maxTokensEnv]?.trim();
  const maxTokens = maxTokensRaw
    ? Number.parseInt(maxTokensRaw, 10)
    : undefined;
  if (maxTokensRaw && (!Number.isFinite(maxTokens) || maxTokens! <= 0)) {
    throw new Error(
      `${maxTokensEnv} must be a positive integer (got: ${maxTokensRaw}).`
    );
  }
  return {
    label: slug,
    modelId: parsed.modelId,
    baseURL: conn.baseURL,
    apiKey: conn.apiKey,
    maxTokens,
    temperature: undefined,
    providerOptions: undefined,
    supportsStructuredOutputs:
      parsed.provider.supportsStructuredOutputs ?? false,
  };
}

function fromConfig(
  slug: string,
  config: OpenAICompatibleModelConfig
): ResolvedTarget {
  const baseURL =
    config.baseURL ?? readEnv(config.baseURLEnv!, slug, "baseURLEnv");
  const apiKey = config.apiKey ?? readEnv(config.apiKeyEnv!, slug, "apiKeyEnv");
  return {
    label: slug,
    modelId: config.model,
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: config.providerOptions,
    supportsStructuredOutputs: config.supportsStructuredOutputs ?? false,
  };
}

function readEnv(envName: string, slug: string, field: string): string {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(
      `Model "${slug}": env var ${envName} (referenced via ${field}) is not set.`
    );
  }
  return value;
}

function buildLanguageModel(
  target: ResolvedTarget,
  modelId: string
): LanguageModel {
  const provider = createOpenAICompatible({
    name: target.label,
    baseURL: target.baseURL,
    apiKey: target.apiKey,
    fetch: slowFetch,
    // When the server can enforce a JSON Schema via
    // `response_format: { type: "json_schema", ... }`, opt into it. Without
    // this flag the AI SDK falls back to the schema-less `json_object` mode,
    // which lets the model invent shape and fails strict Valibot validation
    // (especially for our multi-key MechanismAssessment / minLength reasons).
    supportsStructuredOutputs: target.supportsStructuredOutputs,
  });
  return provider(modelId);
}

// Cache resolution per (baseURL, requestedModelId) so multiple Model instances
// pointing at the same server share a single /v1/models lookup.
const resolutionCache = new Map<string, Promise<string>>();

interface ServedModel {
  readonly id: string;
  readonly root?: string;
}

async function fetchAvailableModels(
  baseURL: string,
  apiKey: string
): Promise<readonly ServedModel[]> {
  const response = await slowFetch(`${baseURL}/models`, {
    headers: {Authorization: `Bearer ${apiKey}`},
  });
  if (!response.ok) {
    throw new Error(
      `GET ${baseURL}/models returned HTTP ${response.status} ${response.statusText}`
    );
  }
  const json = (await response.json()) as {
    data?: {id?: unknown; root?: unknown}[];
  };
  return (json.data ?? []).flatMap(m =>
    typeof m.id === "string"
      ? [{id: m.id, root: typeof m.root === "string" ? m.root : undefined}]
      : []
  );
}

export async function resolveServedModelId(
  target: ResolvedTarget,
  fetchModels: (
    baseURL: string,
    apiKey: string
  ) => Promise<readonly ServedModel[]> = fetchAvailableModels
): Promise<string> {
  let models: readonly ServedModel[];
  try {
    models = await fetchModels(target.baseURL, target.apiKey);
  } catch {
    // Couldn't enumerate (e.g., endpoint missing) — pass the slug through and
    // let the actual chat-completions call surface the real error.
    return target.modelId;
  }
  if (models.length === 0) return target.modelId;
  if (models.some(m => m.id === target.modelId)) return target.modelId;
  const byRoot = models.find(m => m.root === target.modelId);
  if (byRoot) return byRoot.id;
  const formatted = models
    .map(m => (m.root ? `"${m.id}" (root: "${m.root}")` : `"${m.id}"`))
    .join(", ");
  throw new Error(
    `Model "${target.modelId}" is not served at ${target.baseURL}. ` +
      `Available models: ${formatted}.`
  );
}

function resolveModelIdCached(target: ResolvedTarget): Promise<string> {
  const key = `${target.baseURL}::${target.apiKey}::${target.modelId}`;
  let promise = resolutionCache.get(key);
  if (!promise) {
    promise = resolveServedModelId(target);
    // If resolution fails, drop the cache so a later retry can re-attempt
    // (e.g., user fixed the server and re-ran).
    promise.catch(() => {
      if (resolutionCache.get(key) === promise) resolutionCache.delete(key);
    });
    resolutionCache.set(key, promise);
  }
  return promise;
}

function buildModel(target: ResolvedTarget, options?: ModelOptions): Model {
  const retryOptions = buildRetryOptions(target.label, options);
  let languageModelPromise: Promise<LanguageModel> | undefined;

  function getLanguageModel(): Promise<LanguageModel> {
    if (!languageModelPromise) {
      languageModelPromise = (async () => {
        const resolvedId = await resolveModelIdCached(target);
        return buildLanguageModel(target, resolvedId);
      })();
      // Forget a rejected build so a retry can re-resolve.
      languageModelPromise.catch(() => {
        languageModelPromise = undefined;
      });
    }
    return languageModelPromise;
  }

  return {
    async getTextResponse(request: ModelRequest): Promise<string> {
      const languageModel = await getLanguageModel();
      const maxTokens = request.maxTokens ?? target.maxTokens;
      const temperature = request.temperature ?? target.temperature;

      const result = await withRetry(
        () =>
          generateText({
            model: languageModel,
            system: request.messages.find(m => m.role === "system")?.content,
            messages: request.messages
              .filter(m => m.role !== "system")
              .map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: target.providerOptions as
              | Record<string, Record<string, never>>
              | undefined,
            maxRetries: 0,
          }),
        retryOptions
      );

      return result.text;
    },

    async getStructuredResponse<T>(request: TypedModelRequest<T>): Promise<T> {
      const languageModel = await getLanguageModel();
      const outputSchema = toJsonSchema(request.outputType);
      const maxTokens = request.maxTokens ?? target.maxTokens;
      const temperature = request.temperature ?? target.temperature;
      const systemMessage = request.messages.find(
        m => m.role === "system"
      )?.content;
      const userMessages = request.messages
        .filter(m => m.role !== "system")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Try `generateObject` (uses the engine's JSON mode if it supports the
      // OpenAI `response_format` schema). If the engine returns JSON we can't
      // parse, fall back to a prompt-injection round and `extractJson` — same
      // pattern used by the gateway model for Anthropic / Google.
      try {
        return await withRetry(async () => {
          const result = await generateObject({
            model: languageModel,
            system: systemMessage,
            messages: userMessages,
            schema: jsonSchema(outputSchema),
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: target.providerOptions as any,
            maxRetries: 0,
          });
          return v.parse(request.outputType, result.object);
        }, retryOptions);
      } catch (primaryError) {
        const schemaInstruction =
          "Respond with a single JSON object that strictly conforms to this JSON Schema. " +
          "Output JSON only — no prose, no code fences, no <think> tags.\n\n" +
          JSON.stringify(outputSchema);
        const combinedSystem = systemMessage
          ? `${systemMessage}\n\n${schemaInstruction}`
          : schemaInstruction;

        return withRetry(async () => {
          const result = await generateText({
            model: languageModel,
            system: combinedSystem,
            messages: userMessages,
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: target.providerOptions as any,
            maxRetries: 0,
          });

          try {
            const parsed = JSON.parse(extractJson(result.text));
            return v.parse(request.outputType, parsed);
          } catch (fallbackError) {
            const detail =
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError);
            const initial =
              primaryError instanceof Error
                ? primaryError.message
                : String(primaryError);
            throw new Error(
              `Structured output failed for ${target.label}. ` +
                `Primary error: ${initial}. Fallback parse error: ${detail}.`
            );
          }
        }, retryOptions);
      }
    },
  };
}

export function createOpenAICompatibleModelFromSlug(
  slug: string,
  parsed: ParsedProviderSlug,
  options?: ModelOptions
): Model {
  return buildModel(fromParsedSlug(parsed, slug), options);
}

export function createOpenAICompatibleModelFromConfig(
  slug: string,
  config: OpenAICompatibleModelConfig,
  options?: ModelOptions
): Model {
  return buildModel(fromConfig(slug, config), options);
}

// Re-exported so callers don't have to know the parser lives elsewhere.
export type {OpenAICompatibleProvider};
