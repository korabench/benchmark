import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {gateway, generateObject, generateText, jsonSchema} from "ai";
import * as v from "valibot";
import {createLogRetryHandler, RetryOptions, withRetry} from "../retry.js";
import {createFallbackModel} from "./fallbackModel.js";
import {Model} from "./model.js";
import {ModelConfig, resolveModelConfig} from "./modelConfig.js";

export interface ModelOptions {
  retry?: RetryOptions;
}

export interface GatewayModel extends Model {
  /**
   * Model ids the provider reported serving, as seen on each response. A
   * pinned id such as "openai/gpt-5.2" can still resolve to different
   * snapshots over time; this is the only evidence of which one answered.
   */
  readonly served: ReadonlySet<string>;
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

  return {
    served,

    async getTextResponse(request: ModelRequest): Promise<string> {
      const maxTokens = request.maxTokens ?? config.maxTokens;
      const temperature = request.temperature ?? config.temperature;

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
            providerOptions: config.providerOptions as
              | Record<string, Record<string, never>>
              | undefined,
            maxRetries: 0,
          }),
        retryOptions
      );

      served.add(result.response.modelId);
      return result.text;
    },

    async getStructuredResponse<T>(request: TypedModelRequest<T>): Promise<T> {
      const outputSchema = toJsonSchema(request.outputType);
      const maxTokens = request.maxTokens ?? config.maxTokens;
      const temperature = request.temperature ?? config.temperature;
      const systemMessage = request.messages.find(
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
        const combinedSystem = systemMessage
          ? `${systemMessage}\n\n${schemaInstruction}`
          : schemaInstruction;

        return withRetry(async () => {
          const result = await generateText({
            model: gateway(config.model),
            system: combinedSystem,
            messages: userMessages,
            maxOutputTokens: maxTokens,
            temperature,
            providerOptions: config.providerOptions as any,
            maxRetries: 0,
          });

          served.add(result.response.modelId);
          const parsed = JSON.parse(extractJson(result.text));
          return v.parse(request.outputType, parsed);
        }, retryOptions);
      }

      return withRetry(async () => {
        const result = await generateObject({
          model: gateway(config.model),
          system: systemMessage,
          messages: userMessages,
          schema: jsonSchema(outputSchema),
          maxOutputTokens: maxTokens,
          temperature,
          providerOptions: config.providerOptions as any,
          maxRetries: 0,
        });

        served.add(result.response.modelId);
        return v.parse(request.outputType, result.object);
      }, retryOptions);
    },
  };
}
