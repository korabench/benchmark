import type {ModelSpec} from "@korabench/benchmark";
import type {ModelRequest} from "@korabench/core";
import type {GatewayModel} from "./gatewayModel.js";

/** CLI-only transport. The shared benchmark recipe has no env/network access. */
export function createMimesisModel(spec: ModelSpec): GatewayModel {
  const base = process.env.MIMESIS_BASE_URL;
  const key = process.env.MIMESIS_API_KEY?.trim();
  if (!base || !key || /[\r\n]/.test(key))
    throw new Error("MIMESIS_BASE_URL and MIMESIS_API_KEY are required.");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(
      "MIMESIS_BASE_URL must be an HTTPS API base ending in /v1."
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/$/, "").endsWith("/v1")
  )
    throw new Error(
      "MIMESIS_BASE_URL must be an HTTPS API base ending in /v1."
    );
  const served = new Set<string>();
  const usage = {inputTokens: 0, cachedInputTokens: 0};
  return {
    served,
    usage,
    async getTextResponse(request: ModelRequest) {
      const signal = AbortSignal.timeout(600_000);
      const body = JSON.stringify({
        model: "mimesis-9b",
        messages: request.messages,
        max_tokens: request.maxTokens ?? spec.maxTokens ?? 4096,
        temperature: request.temperature ?? spec.temperature ?? 1,
        top_p: 0.95,
        stream: false,
      });
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetch(
            `${url.href.replace(/\/$/, "")}/chat/completions`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${key}`,
                "content-type": "application/json",
              },
              body,
              signal,
              redirect: "error",
            }
          );
        } catch {
          throw new Error("MIMESIS transport failed or timed out.");
        }
        if (response.status === 429 || response.status === 503) {
          await response.body?.cancel();
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(new Error("MIMESIS startup/capacity timeout."));
            };
            const timer = setTimeout(
              () => {
                signal.removeEventListener("abort", abort);
                resolve();
              },
              Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4))
            );
            signal.addEventListener("abort", abort, {once: true});
            if (signal.aborted) abort();
          });
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`MIMESIS returned HTTP ${response.status}.`);
        }
        let data;
        try {
          data = (await response.json()) as {
            choices?: {
              message?: {
                content?: unknown;
                tool_calls?: unknown[];
                refusal?: unknown;
              };
              finish_reason?: string;
            }[];
            model?: string;
            usage?: {prompt_tokens?: number};
          };
        } catch {
          throw new Error("MIMESIS returned invalid JSON.");
        }
        const choice = data.choices?.length === 1 ? data.choices[0] : undefined;
        const output = choice?.message?.content;
        if (choice?.finish_reason === "length")
          throw new Error("Response truncated: max output tokens reached.");
        if (
          choice?.finish_reason !== "stop" ||
          choice.message?.refusal ||
          choice.message?.tool_calls?.length ||
          typeof output !== "string" ||
          !output.trim() ||
          /<\s*\/?\s*think\b/i.test(output)
        )
          throw new Error("MIMESIS returned an invalid visible child message.");
        if (data.model) served.add(data.model);
        usage.inputTokens += data.usage?.prompt_tokens ?? 0;
        return output;
      }
    },
    async getStructuredResponse() {
      throw new Error("MIMESIS supports text only.");
    },
  };
}
