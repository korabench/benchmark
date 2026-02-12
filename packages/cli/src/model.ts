import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {gateway, generateText, jsonSchema, Output} from "ai";
import * as v from "valibot";
import {getCustomTextResponse} from "./customModel.js";
import {resolveModelConfig} from "./modelConfig.js";
import {createLogRetryHandler, RetryOptions, withRetry} from "./retry.js";

export interface ModelOptions {
  retry?: RetryOptions;
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

export async function getStructuredResponse<T>(
  modelsJsonPath: string,
  modelSlug: string,
  request: TypedModelRequest<T>,
  options?: ModelOptions
): Promise<T> {
  const config = resolveModelConfig(modelsJsonPath, modelSlug);
  const outputSchema = toJsonSchema(request.outputType);
  const maxTokens = request.maxTokens ?? config.maxTokens;
  const temperature = request.temperature ?? config.temperature;
  const retryOptions = buildRetryOptions(config.model, options);

  return withRetry(async () => {
    const result = await generateText({
      model: gateway(config.model),
      system: request.messages.find(m => m.role === "system")?.content,
      messages: request.messages
        .filter(m => m.role !== "system")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      output: Output.object({schema: jsonSchema(outputSchema)}),
      maxOutputTokens: maxTokens,
      temperature,
      providerOptions: config.providerOptions as any,
      maxRetries: 0, // Disable SDK retries; we handle it ourselves
    });

    // Validate inside retry so malformed responses are retried
    return v.parse(request.outputType, result.output);
  }, retryOptions);
}

export async function getTextResponse(
  modelsJsonPath: string,
  modelSlug: string,
  request: ModelRequest,
  options?: ModelOptions
): Promise<string> {
  if (modelSlug.startsWith("custom-")) {
    return getCustomTextResponse(
      modelSlug,
      request,
      buildRetryOptions(modelSlug, options)
    );
  }

  const config = resolveModelConfig(modelsJsonPath, modelSlug);
  const maxTokens = request.maxTokens ?? config.maxTokens;
  const temperature = request.temperature ?? config.temperature;
  const retryOptions = buildRetryOptions(config.model, options);

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
        maxRetries: 0, // Disable SDK retries; we handle it ourselves
      }),
    retryOptions
  );

  return result.text;
}
