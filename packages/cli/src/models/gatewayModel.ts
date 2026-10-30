import {parseDroppingExtraKeys} from "@korabench/benchmark";
import {ModelRequest} from "@korabench/core";
import {
  gateway,
  generateObject,
  generateText,
  jsonSchema,
  LanguageModelUsage,
  SystemModelMessage,
} from "ai";
import * as v from "valibot";
import {createLogRetryHandler, RetryOptions, withRetry} from "../retry.js";
import {createFallbackModel} from "./fallbackModel.js";
import {Model, ReasonedTextResponse, StructuredRequest} from "./model.js";
import {ModelConfig, resolveModelConfig} from "./modelConfig.js";
import {toProviderSchema} from "./providerSchema.js";

export interface ModelOptions {
  retry?: RetryOptions;
  /** Native child pipelines must retain the first draw, including truncation. */
  rejectTruncated?: boolean;
}

export interface GatewayModel extends Model {
  /**
   * Model ids the provider reported serving, as seen on each response. A
   * pinned id such as "openai/gpt-5.2" can still resolve to different
   * snapshots over time; this is the only evidence of which one answered.
   */
  readonly served: ReadonlySet<string>;
  /** Input tokens sent, and how many of them the provider read from its cache. */
  readonly usage: Readonly<InputTokenUsage>;
}

export interface InputTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
}

//
// Prompt caching.
//
// Requests that share a `promptCacheKey` share a long system prompt (one gold
// standard's judge rubric). OpenAI caches long prefixes on its own; the key
// routes the requests to the same cache, and the 24-hour retention keeps the
// prefix between two conversations of one gold standard, which a shuffled
// corpus spaces out well past the default in-memory lifetime. Anthropic caches
// only a marked prefix, so the system message carries the mark. Google caches
// implicitly and takes no hint.
//

type ProviderOptions = Record<string, Record<string, unknown>>;

function withPromptCacheKey(
  model: string,
  providerOptions: ProviderOptions | undefined,
  promptCacheKey: string | undefined
): ProviderOptions | undefined {
  if (!promptCacheKey || !model.startsWith("openai/")) {
    return providerOptions;
  }
  return {
    ...providerOptions,
    openai: {
      ...providerOptions?.["openai"],
      promptCacheKey,
      promptCacheRetention: "24h",
    },
  };
}

function systemMessage(
  model: string,
  content: string,
  promptCacheKey: string | undefined
): SystemModelMessage {
  return promptCacheKey && model.startsWith("anthropic/")
    ? {
        role: "system",
        content,
        providerOptions: {anthropic: {cacheControl: {type: "ephemeral"}}},
      }
    : {role: "system", content};
}

//
// Reasoning visibility.
//
// Thinking models bill their reasoning whether or not they return its text;
// OpenAI, Anthropic (Claude 4.7+) and Google return it only when asked, as a
// summary. Asking adds no generation cost and changes nothing about how the
// model thinks, so the tested model asks wherever thinking is already on. It
// never turns thinking on: a config without it stays without it, except for
// models that think adaptively by default (Claude Fable), whose default is
// spelled out so it can carry the display option. Other providers return
// their reasoning unasked.
//

const ANTHROPIC_ADAPTIVE_BY_DEFAULT = ["anthropic/claude-fable-"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withVisibleReasoning(
  model: string,
  providerOptions: ProviderOptions | undefined
): ProviderOptions | undefined {
  if (model.startsWith("openai/")) {
    return {
      ...providerOptions,
      openai: {...providerOptions?.["openai"], reasoningSummary: "auto"},
    };
  }
  if (model.startsWith("anthropic/")) {
    const anthropic = providerOptions?.["anthropic"];
    const thinking =
      anthropic?.["thinking"] ??
      (ANTHROPIC_ADAPTIVE_BY_DEFAULT.some(p => model.startsWith(p))
        ? {type: "adaptive"}
        : undefined);
    if (!isRecord(thinking) || thinking["type"] === "disabled") {
      return providerOptions;
    }
    return {
      ...providerOptions,
      anthropic: {...anthropic, thinking: {...thinking, display: "summarized"}},
    };
  }
  if (model.startsWith("google/gemini")) {
    const google = providerOptions?.["google"];
    const thinkingConfig = google?.["thinkingConfig"];
    if (isRecord(thinkingConfig) && thinkingConfig["thinkingBudget"] === 0) {
      return providerOptions;
    }
    return {
      ...providerOptions,
      google: {
        ...google,
        thinkingConfig: {
          ...(isRecord(thinkingConfig) ? thinkingConfig : {}),
          includeThoughts: true,
        },
      },
    };
  }
  return providerOptions;
}

const defaultRetryOptions: RetryOptions = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

function buildRetryOptions(
  label: string,
  options?: ModelOptions
): Required<Pick<RetryOptions, "onRetry">> & RetryOptions {
  return {
    ...defaultRetryOptions,
    ...options?.retry,
    onRetry: options?.retry?.onRetry ?? createLogRetryHandler(label),
  };
}

// The Vercel AI Gateway corrupts structured-output responses for Anthropic
// (tool arguments dropped, returned as "{}") and for Google (thinking tags
// leak into text when structuredOutputs is off). Bypass generateObject for
// both providers and extract JSON from the plain-text response.
function extractJson(text: string): string {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenceMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return withoutThink;
  return withoutThink.slice(start, end + 1);
}

export function createGatewayModelChain(
  modelsJsonPath: string,
  modelSlugs: readonly string[],
  options?: ModelOptions
): Model {
  if (modelSlugs.length === 0) {
    throw new Error("createGatewayModelChain: at least one slug required.");
  }
  return createFallbackModel(
    modelSlugs.map(slug => ({
      label: slug,
      model: createGatewayModel(modelsJsonPath, slug, options),
    }))
  );
}

export function createGatewayModel(
  modelsJsonPath: string,
  modelSlug: string,
  options?: ModelOptions
): GatewayModel {
  return createGatewayModelFromConfig(
    resolveModelConfig(modelsJsonPath, modelSlug),
    modelSlug,
    options
  );
}

/** Build a gateway model from an inline config (no registry lookup). */
export function createGatewayModelFromConfig(
  config: ModelConfig,
  label: string,
  options?: ModelOptions
): GatewayModel {
  const retryLabel =
    label === config.model ? label : `${label} (${config.model})`;
  const retryOptions = buildRetryOptions(retryLabel, options);
  const served = new Set<string>();
  const usage: InputTokenUsage = {inputTokens: 0, cachedInputTokens: 0};

  function record(result: {
    response: {modelId: string};
    usage: LanguageModelUsage;
  }) {
    served.add(result.response.modelId);
    usage.inputTokens += result.usage.inputTokens ?? 0;
    usage.cachedInputTokens +=
      result.usage.inputTokenDetails.cacheReadTokens ?? 0;
  }

  async function generateTextResponse(
    request: ModelRequest,
    includeReasoning: boolean
  ): Promise<ReasonedTextResponse> {
    const maxTokens = request.maxTokens ?? config.maxTokens;
    const temperature = request.temperature ?? config.temperature;
    const configOptions = config.providerOptions as ProviderOptions | undefined;
    const providerOptions = includeReasoning
      ? withVisibleReasoning(config.model, configOptions)
      : configOptions;

    const result = await withRetry(
      () =>
        generateText({
          model: gateway(config.model),
          system: request.messages.find(m => m.role === "system")?.content,
          messages: request.messages
            .filter(m => m.role !== "system")
            .map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          maxOutputTokens: maxTokens,
          temperature,
          providerOptions: providerOptions as
            | Record<string, Record<string, never>>
            | undefined,
          maxRetries: 0,
        }).then(result => {
          if (config.model === "google/gemma-4-31b-it") {
            if (result.finishReason === "length") {
              throw new Error("Response truncated: max output tokens reached.");
            }
            if (
              result.finishReason === "content-filter" ||
              result.finishReason === "error" ||
              !result.text.trim()
            ) {
              throw new Error(
                `Gemma generation failed (${result.finishReason}): no usable child message.`
              );
            }
          }
          return result;
        }),
      retryOptions
    );

    record(result);
    if (options?.rejectTruncated && result.finishReason === "length") {
      throw new Error("Response truncated: max output tokens reached.");
    }
    if (!includeReasoning) {
      return {text: result.text};
    }
    return {
      text: result.text,
      reasoning: result.reasoningText || undefined,
      reasoningTokens: result.usage.outputTokenDetails.reasoningTokens,
    };
  }

  return {
    served,
    usage,

    async getTextResponse(request: ModelRequest): Promise<string> {
      return (await generateTextResponse(request, false)).text;
    },

    getTextResponseWithReasoning(
      request: ModelRequest
    ): Promise<ReasonedTextResponse> {
      return generateTextResponse(request, true);
    },

    async getStructuredResponse<T>(request: StructuredRequest<T>): Promise<T> {
      const outputSchema = toProviderSchema(request.outputType);
      const maxTokens = request.maxTokens ?? config.maxTokens;
      const temperature = request.temperature ?? config.temperature;
      const {promptCacheKey} = request;
      const providerOptions = withPromptCacheKey(
        config.model,
        config.providerOptions as ProviderOptions | undefined,
        promptCacheKey
      );
      const systemContent = request.messages.find(
        m => m.role === "system"
      )?.content;
      const userMessages = request.messages
        .filter(m => m.role !== "system")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      if (
        config.model.startsWith("google/") ||
        config.model.startsWith("anthropic/")
      ) {
        const schemaInstruction =
          "Respond with a single JSON object that strictly conforms to this JSON Schema. " +
          "Output JSON only — no prose, no code fences, no <think> tags.\n\n" +
          JSON.stringify(outputSchema);
        const combinedSystem = systemContent
          ? `${systemContent}\n\n${schemaInstruction}`
          : schemaInstruction;

        return withRetry(async () => {
          const result = await generateText({
            model: gateway(config.model),
            messages: [
              systemMessage(config.model, combinedSystem, promptCacheKey),
              ...userMessages,
            ],
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: providerOptions as any,
            maxRetries: 0,
          });

          record(result);
          const parsed = JSON.parse(extractJson(result.text));
          const {output, dropped} = parseDroppingExtraKeys(
            request.outputType,
            parsed
          );
          if (dropped.length > 0) {
            console.warn(
              `[${config.model}] dropped keys the schema does not define: ${dropped.join(", ")}`
            );
          }
          return output;
        }, retryOptions);
      }

      return withRetry(async () => {
        const result = await generateObject({
          model: gateway(config.model),
          system: systemContent,
          messages: userMessages,
          schema: jsonSchema(outputSchema),
          maxOutputTokens: maxTokens,
          temperature,
          providerOptions: providerOptions as any,
          maxRetries: 0,
        });

        record(result);
        return v.parse(request.outputType, result.object);
      }, retryOptions);
    },
  };
}
