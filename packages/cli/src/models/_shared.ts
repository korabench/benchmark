import {createLogRetryHandler, RetryOptions} from "../retry.js";

export interface ModelOptions {
  retry?: RetryOptions;
}

export const defaultRetryOptions: RetryOptions = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

export function buildRetryOptions(
  label: string,
  options?: ModelOptions
): Required<Pick<RetryOptions, "onRetry">> & RetryOptions {
  return {
    ...defaultRetryOptions,
    ...options?.retry,
    onRetry: options?.retry?.onRetry ?? createLogRetryHandler(label),
  };
}

// Strips <think> tags, code fences, and surrounding prose from a model
// response so the embedded JSON object can be parsed.
export function extractJson(text: string): string {
  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenceMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return withoutThink;
  return withoutThink.slice(start, end + 1);
}
