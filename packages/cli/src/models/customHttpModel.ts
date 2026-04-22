import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {createLogRetryHandler, RetryOptions, withRetry} from "../retry.js";
import {Model} from "./model.js";

const CUSTOM_HTTP_PREFIX = "custom-http:";

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

export function isCustomHttpSlug(slug: string): boolean {
  return slug.startsWith(CUSTOM_HTTP_PREFIX);
}

// Reasoning models served without a reasoning parser (e.g. Qwen3 or
// DeepSeek-R1 on a plain vLLM/Ollama endpoint) put their chain of thought
// inline in `content`. Gateway targets never expose it to the judge, so
// strip a leading <think> block to keep the two paths comparable.
function stripLeadingThink(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
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
  };

  async function postChat(request: ModelRequest): Promise<string> {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model ?? config.modelSlug,
        messages: request.messages,
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        ...(request.maxTokens !== undefined && {
          max_tokens: request.maxTokens,
        }),
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`custom-http ${r.status}: ${text.slice(0, 300)}`);
    }
    const data = (await r.json()) as {
      choices?: Array<{message?: {content?: string | null}}>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        `custom-http response missing choices[0].message.content: ` +
          JSON.stringify(data).slice(0, 300)
      );
    }
    return stripLeadingThink(content);
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
