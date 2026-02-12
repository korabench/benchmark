import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {gateway, generateText, jsonSchema, Output} from "ai";
import * as v from "valibot";
import {ModelConfig} from "./modelConfig.js";
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

export async function getStructuredResponse<T>(
  config: ModelConfig,
  request: TypedModelRequest<T>,
  options?: ModelOptions
): Promise<T> {
  const outputSchema = toJsonSchema(request.outputType);
  const maxTokens = request.maxTokens ?? config.maxTokens ?? 4000;
  const temperature = request.temperature ?? config.temperature;
  const retryOptions = {
    ...defaultRetryOptions,
    ...options?.retry,
    onRetry: options?.retry?.onRetry ?? createLogRetryHandler(config.model),
  };

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
  config: ModelConfig,
  request: ModelRequest,
  options?: ModelOptions
): Promise<string> {
  const maxTokens = request.maxTokens ?? config.maxTokens ?? 4000;
  const temperature = request.temperature ?? config.temperature;
  const retryOptions = {
    ...defaultRetryOptions,
    ...options?.retry,
    onRetry: options?.retry?.onRetry ?? createLogRetryHandler(config.model),
  };

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
