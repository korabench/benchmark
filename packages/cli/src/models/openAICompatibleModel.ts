import {createOpenAICompatible} from "@ai-sdk/openai-compatible";
import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {generateObject, generateText, jsonSchema, LanguageModel} from "ai";
import * as v from "valibot";
import {withRetry} from "../retry.js";
import {ModelOptions, buildRetryOptions, extractJson} from "./_shared.js";
import {Model} from "./model.js";
import {OpenAICompatibleModelConfig} from "./modelConfig.js";
import {
  OpenAICompatibleProvider,
  ParsedProviderSlug,
  resolveProviderConnection,
} from "./openAICompatibleProviders.js";

interface ResolvedTarget {
  label: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  maxTokens: number | undefined;
  temperature: number | undefined;
  providerOptions: OpenAICompatibleModelConfig["providerOptions"];
}

function fromParsedSlug(parsed: ParsedProviderSlug, slug: string): ResolvedTarget {
  const conn = resolveProviderConnection(parsed.provider);
  return {
    label: slug,
    modelId: parsed.modelId,
    baseURL: conn.baseURL,
    apiKey: conn.apiKey,
    maxTokens: undefined,
    temperature: undefined,
    providerOptions: undefined,
  };
}

function fromConfig(
  slug: string,
  config: OpenAICompatibleModelConfig
): ResolvedTarget {
  const baseURL = config.baseURL ?? readEnv(config.baseURLEnv!, slug, "baseURLEnv");
  const apiKey = config.apiKey ?? readEnv(config.apiKeyEnv!, slug, "apiKeyEnv");
  return {
    label: slug,
    modelId: config.model,
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: config.providerOptions,
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

function buildLanguageModel(target: ResolvedTarget): LanguageModel {
  const provider = createOpenAICompatible({
    name: target.label,
    baseURL: target.baseURL,
    apiKey: target.apiKey,
  });
  return provider(target.modelId);
}

function buildModel(target: ResolvedTarget, options?: ModelOptions): Model {
  const retryOptions = buildRetryOptions(target.label, options);
  const languageModel = buildLanguageModel(target);

  return {
    async getTextResponse(request: ModelRequest): Promise<string> {
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
