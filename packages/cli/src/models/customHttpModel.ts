import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {
  createLogRetryHandler,
  isRetryableError,
  RetryOptions,
  withRetry,
} from "../retry.js";
import {Model} from "./model.js";

const CUSTOM_HTTP_PREFIX = "custom-http:";
const THINK_CLOSE = "</think>";

interface CustomHttpModelConfig {
  modelSlug: string;
  /** Sent as the request's `model` field. Defaults to the full slug, which
   * suits wrapper services that ignore the field; OpenAI-compatible servers
   * that host several models (vLLM, Ollama, Groq, Together, ...) need the
   * real model id here. */
  model?: string;
  /** Optional bearer token sent as `Authorization: Bearer <key>`. When
   * omitted, no auth header is sent (suits a local, unauthenticated server). */
  apiKey?: string;
  retry?: RetryOptions;
}

/** A failure whose cause is known, so retrying is decided by that cause rather
 * than by keywords in the message: OpenAI-compatible servers put
 * "invalid_request_error" in every 4xx body, which the message heuristic would
 * treat as transient. */
class CustomHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "CustomHttpError";
  }
}

export function isCustomHttpSlug(slug: string): boolean {
  return slug.startsWith(CUSTOM_HTTP_PREFIX);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function shouldRetry(error: unknown): boolean {
  return error instanceof CustomHttpError
    ? error.retryable
    : isRetryableError(error);
}

// Reasoning models served without a reasoning parser (e.g. Qwen3 or
// DeepSeek-R1 on a plain vLLM/llama.cpp endpoint) put their chain of thought
// inline in `content`. Gateway targets never expose it to the judge, so drop
// everything up to the closing tag. Some chat templates open the <think> block
// in the prompt, so the reply carries only the closing tag. A block that never
// closes (reasoning cut off by max tokens) has no answer to grade.
function stripReasoning(content: string): string {
  const close = content.indexOf(THINK_CLOSE);
  if (close !== -1) {
    return content.slice(close + THINK_CLOSE.length).trim();
  }
  if (content.trimStart().startsWith("<think>")) {
    throw new CustomHttpError(
      `custom-http response is an unterminated <think> block, with no ` +
        `answer after the reasoning (did it hit the server's max tokens?)`,
      false
    );
  }
  return content;
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Node's fetch reports every network failure as "fetch failed" and keeps
  // the actual reason (ECONNRESET, ECONNREFUSED, ...) on `cause`.
  const cause = error.cause as {code?: unknown; message?: unknown} | undefined;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message} (${String(detail)})` : error.message;
}

/**
 * Target model that POSTs each conversation to any endpoint implementing the
 * OpenAI chat-completions schema. The slug carries the URL:
 *
 *   custom-http:http://localhost:8000/v1/chat/completions
 *   custom-http:https://api.groq.com/openai/v1/chat/completions
 *
 * This lets the benchmark target self-hosted open-weight models, inference
 * providers outside the AI Gateway, or guard/wrapper services without
 * editing customModel.ts. It is a target-only model: structured responses
 * (judges, scenario generation) stay on gateway models.
 */
export function createCustomHttpModel(config: CustomHttpModelConfig): Model {
  const url = config.modelSlug.slice(CUSTOM_HTTP_PREFIX.length);
  if (!url) {
    throw new Error(
      `custom-http slug is missing a URL. Use "custom-http:<url>", e.g. ` +
        `"custom-http:http://localhost:8000/v1/chat/completions".`
    );
  }

  const headers: Record<string, string> = {"content-type": "application/json"};
  if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;

  const retryOptions: RetryOptions = {
    ...config.retry,
    onRetry: config.retry?.onRetry ?? createLogRetryHandler(config.modelSlug),
    shouldRetry: config.retry?.shouldRetry ?? shouldRetry,
  };

  async function send(body: string): Promise<Response> {
    try {
      return await fetch(url, {method: "POST", headers, body});
    } catch (error) {
      throw new CustomHttpError(
        `custom-http request to ${url} failed: ${describeFetchError(error)}`,
        true
      );
    }
  }

  async function postChat(request: ModelRequest): Promise<string> {
    const r = await send(
      JSON.stringify({
        model: config.model ?? config.modelSlug,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.maxTokens !== undefined && {
          max_tokens: request.maxTokens,
        }),
      })
    );
    if (!r.ok) {
      const text = await r.text();
      // Servers hosting several models reject the slug as a model id.
      const hint =
        config.model === undefined && (r.status === 400 || r.status === 404)
          ? ` (the request's model was the slug; set CUSTOM_HTTP_MODEL to ` +
            `the id the server expects)`
          : "";
      throw new CustomHttpError(
        `custom-http ${r.status}: ${text.slice(0, 300)}${hint}`,
        isRetryableStatus(r.status)
      );
    }
    const data = (await r.json()) as {
      choices?: Array<{message?: {content?: string | null}}>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new CustomHttpError(
        `custom-http response missing choices[0].message.content: ` +
          JSON.stringify(data).slice(0, 300),
        false
      );
    }
    return stripReasoning(content);
  }

  return {
    getTextResponse(request: ModelRequest): Promise<string> {
      return withRetry(() => postChat(request), retryOptions);
    },

    async getStructuredResponse<T>(_request: TypedModelRequest<T>): Promise<T> {
      throw new Error(
        `custom-http targets do not support structured output. Use a ` +
          `gateway model for judges. Slug: ${config.modelSlug}`
      );
    },
  };
}
