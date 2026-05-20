import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {randomUUID} from "node:crypto";
import {Model} from "./model.js";

const KORA_APP_PREFIX = "kora-app-";

export type BlockedReason =
  | "captcha"
  | "rate_limit"
  | "login_required"
  | "country_block"
  | "account_suspended"
  | "unknown_block";

export class BlockedAppError extends Error {
  constructor(readonly reason: BlockedReason) {
    super(`App blocked: ${reason}`);
    this.name = "BlockedAppError";
  }
}

interface WebRunnerModelConfig {
  modelSlug: string;
  webRunnerUrl: string;
  /** Optional bearer token sent as `Authorization: Bearer <key>`. When omitted,
   * no auth header is sent (suits an unauthenticated local web-runner). */
  apiKey?: string;
  /** Optional identifiers passed to web-runner for evidence keying. If absent,
   * fresh UUIDs are minted per Model instance (one Model per test). */
  runId?: string;
  testKey?: string;
}

function modelSlugToApp(slug: string): string {
  if (!slug.startsWith(KORA_APP_PREFIX)) {
    throw new Error(
      `WebRunnerModel expected a slug starting with "${KORA_APP_PREFIX}"; got "${slug}"`
    );
  }
  return slug.slice(KORA_APP_PREFIX.length);
}

function lastUserContent(messages: ModelRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  throw new Error("No user message in request transcript.");
}

/**
 * Model that drives a real browser session against an AI app via the
 * `kora-apps` web-runner HTTP service. Implements kora-benchmark's `Model`
 * interface so it slots into `buildContext` like any other target.
 *
 * Lifecycle: lazily opens a session keyed by (runId, testKey) on the first
 * `getTextResponse` call. Subsequent calls within the same test send only the
 * latest user turn — the live browser session keeps the conversation state
 * itself. `dispose` closes the session and releases the underlying resources.
 */
export function createWebRunnerModel(config: WebRunnerModelConfig): Model {
  const app = modelSlugToApp(config.modelSlug);
  // kora-benchmark's TestContext does not thread runId/testKey through the
  // assistant request, so we mint our own per-Model identifiers. Each test
  // creates a fresh Model via createCustomModel, so each session is unique.
  const runId = config.runId ?? randomUUID();
  const testKey = config.testKey ?? randomUUID();
  let sessionId: string | null = null;

  const headers: Record<string, string> = {"content-type": "application/json"};
  if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const r = await fetch(`${config.webRunnerUrl}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({runId, testKey, app}),
    });
    if (!r.ok) {
      throw new Error(
        `web-runner POST /sessions failed: ${r.status} ${await r.text()}`
      );
    }
    const data = (await r.json()) as {
      sessionId?: string;
      blockedReason?: BlockedReason;
    };
    if (data.blockedReason) throw new BlockedAppError(data.blockedReason);
    if (!data.sessionId) throw new Error("web-runner did not return sessionId");
    sessionId = data.sessionId;
    return sessionId;
  }

  async function postTurn(text: string): Promise<string> {
    if (!sessionId) throw new Error("Session not open.");
    const r = await fetch(`${config.webRunnerUrl}/sessions/${sessionId}/turn`, {
      method: "POST",
      headers,
      body: JSON.stringify({userMessage: text}),
    });
    if (!r.ok) {
      throw new Error(
        `web-runner POST /sessions/${sessionId}/turn failed: ${r.status} ${await r.text()}`
      );
    }
    const data = (await r.json()) as {
      assistantMessage?: string;
      blockedReason?: BlockedReason;
    };
    if (data.blockedReason) throw new BlockedAppError(data.blockedReason);
    if (typeof data.assistantMessage !== "string") {
      throw new Error("web-runner did not return assistantMessage");
    }
    return data.assistantMessage;
  }

  return {
    async getTextResponse(request: ModelRequest): Promise<string> {
      await ensureSession();
      return postTurn(lastUserContent(request.messages));
    },

    async getStructuredResponse<T>(_request: TypedModelRequest<T>): Promise<T> {
      throw new Error(
        `kora-app:* targets do not support structured output. Slug: ${config.modelSlug}`
      );
    },

    async dispose(outcome) {
      if (!sessionId) return;
      const id = sessionId;
      sessionId = null;
      try {
        await fetch(`${config.webRunnerUrl}/sessions/${id}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({outcome}),
        });
      } catch (err) {
        // Best-effort — log to stderr so it's visible without throwing.
        console.error(
          `web-runner DELETE /sessions/${id} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    },
  };
}

export function isWebRunnerSlug(slug: string): boolean {
  return slug.startsWith(KORA_APP_PREFIX);
}
