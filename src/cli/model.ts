import {ModelMessage} from "@korabench/core";
import {toJsonSchema} from "@valibot/to-json-schema";
import {generateText, gateway, jsonSchema, Output} from "ai";
import * as v from "valibot";

export async function getStructuredResponse<T>(
  modelSlug: string,
  messages: ModelMessage[],
  outputType: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
  options?: {maxTokens?: number; temperature?: number}
): Promise<T> {
  const outputSchema = toJsonSchema(outputType);
  const maxTokens = options?.maxTokens || 4000;

  const result = await generateText({
    model: gateway(modelSlug),
    system: messages.find(m => m.role === "system")?.content,
    messages: messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    output: Output.object({schema: jsonSchema(outputSchema)}),
    maxOutputTokens: maxTokens,
    temperature: options?.temperature,
  });

  return v.parse(outputType, result.output);
}

export async function getTextResponse(
  modelSlug: string,
  messages: ModelMessage[],
  options?: {maxTokens?: number; temperature?: number}
): Promise<string> {
  const maxTokens = options?.maxTokens || 4000;

  const result = await generateText({
    model: gateway(modelSlug),
    system: messages.find(m => m.role === "system")?.content,
    messages: messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    maxOutputTokens: maxTokens,
    temperature: options?.temperature,
  });

  return result.text;
}
