// Built-in registry of OpenAI-compatible providers, keyed by the slug prefix
// used in `<prefix>/<model-id>` (e.g., "vllm/Qwen/Qwen3-30B-A3B-Thinking-2507").
//
// To add a new provider, append an entry below. The dispatcher will then
// recognise its prefix automatically — no changes needed elsewhere.
//
// TODO: add the following providers (single-line entries each):
//   - sglang        baseURLEnv: SGLANG_BASE_URL,        apiKeyEnv: SGLANG_API_KEY
//   - ollama        defaultBaseURL: http://localhost:11434/v1
//   - lmstudio      defaultBaseURL: http://localhost:1234/v1
//   - llamacpp      defaultBaseURL: http://localhost:8080/v1
//   - together      defaultBaseURL: https://api.together.xyz/v1
//   - fireworks     defaultBaseURL: https://api.fireworks.ai/inference/v1
//   - groq          defaultBaseURL: https://api.groq.com/openai/v1
//   - deepinfra     defaultBaseURL: https://api.deepinfra.com/v1/openai
//   - openrouter    defaultBaseURL: https://openrouter.ai/api/v1
//   - perplexity    defaultBaseURL: https://api.perplexity.ai
//   - cerebras      defaultBaseURL: https://api.cerebras.ai/v1
//   - mistral       defaultBaseURL: https://api.mistral.ai/v1
//   - anyscale      defaultBaseURL: https://api.endpoints.anyscale.com/v1
//
// Note on `openai`: the prefix routes directly to api.openai.com via the
// Chat Completions API, bypassing the AI SDK gateway. Use it when you want
// to hit OpenAI without the gateway (e.g., for keys that aren't gateway-
// enabled). Gateway-routed OpenAI models are still addressed by their named
// entries in `models.json` (e.g., `gpt-4o`, `gpt-5.2:high`).

export interface OpenAICompatibleProvider {
  /** The prefix used in slugs, e.g., "vllm". */
  readonly prefix: string;
  /** Default base URL when the env override is not set. `undefined` means the env var is required. */
  readonly defaultBaseURL?: string;
  /** Env var name that overrides (or supplies) the base URL. */
  readonly baseURLEnv: string;
  /** Env var name for the API key. */
  readonly apiKeyEnv: string;
  /** When true, an empty/missing API key is acceptable (sent as "EMPTY"). */
  readonly apiKeyOptional?: boolean;
  /**
   * When true, the server supports `response_format: { type: "json_schema",
   * json_schema: { ... } }` and the AI SDK will forward the full schema for
   * server-side enforcement. When false (or omitted), the SDK falls back to
   * `response_format: { type: "json_object" }`, which produces *some* JSON
   * but does not constrain its shape — strict Valibot schemas with required
   * keys / length bounds will fail validation and trigger retries.
   */
  readonly supportsStructuredOutputs?: boolean;
}

const PROVIDERS: readonly OpenAICompatibleProvider[] = [
  {
    prefix: "vllm",
    baseURLEnv: "VLLM_BASE_URL",
    apiKeyEnv: "VLLM_API_KEY",
    apiKeyOptional: true,
    supportsStructuredOutputs: true,
  },
  {
    prefix: "openai",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURLEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
    supportsStructuredOutputs: true,
  },
];

const PROVIDERS_BY_PREFIX = new Map(PROVIDERS.map(p => [p.prefix, p]));

export function getOpenAICompatibleProvider(
  prefix: string
): OpenAICompatibleProvider | undefined {
  return PROVIDERS_BY_PREFIX.get(prefix);
}

export function listOpenAICompatibleProviders(): readonly OpenAICompatibleProvider[] {
  return PROVIDERS;
}

export interface ParsedProviderSlug {
  provider: OpenAICompatibleProvider;
  modelId: string;
}

/**
 * Parses a slug of the form `<prefix>/<model-id>`. Returns `undefined` if
 * the slug has no `/` or the prefix is not a registered provider.
 *
 * `model-id` may contain additional `/` characters (e.g., HuggingFace-style
 * `Qwen/Qwen3-30B-A3B-Thinking-2507`).
 */
export function parseProviderSlug(
  slug: string
): ParsedProviderSlug | undefined {
  const slash = slug.indexOf("/");
  if (slash <= 0 || slash === slug.length - 1) return undefined;
  const prefix = slug.slice(0, slash);
  const modelId = slug.slice(slash + 1);
  const provider = getOpenAICompatibleProvider(prefix);
  if (!provider) return undefined;
  return {provider, modelId};
}

export interface ResolvedConnection {
  baseURL: string;
  apiKey: string;
}

/**
 * Reads env vars and produces the concrete (baseURL, apiKey) pair to use
 * with the OpenAI-compatible client. Throws a precise error if a required
 * env var is missing.
 */
export function resolveProviderConnection(
  provider: OpenAICompatibleProvider
): ResolvedConnection {
  const baseURLFromEnv = process.env[provider.baseURLEnv]?.trim();
  const baseURL = baseURLFromEnv || provider.defaultBaseURL;
  if (!baseURL) {
    throw new Error(
      `Provider "${provider.prefix}" requires env var ${provider.baseURLEnv} ` +
        `to be set (no default base URL).`
    );
  }

  const apiKeyFromEnv = process.env[provider.apiKeyEnv]?.trim();
  if (!apiKeyFromEnv && !provider.apiKeyOptional) {
    throw new Error(
      `Provider "${provider.prefix}" requires env var ${provider.apiKeyEnv} to be set.`
    );
  }

  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey: apiKeyFromEnv || "EMPTY",
  };
}
