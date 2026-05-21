import {ModelRequest, TypedModelRequest} from "@korabench/core";
import {randomUUID} from "node:crypto";
import {Model} from "./model.js";

const KORA_APP_PREFIX = "kora-app-";
const NATIVE_SUFFIXES = ["-android"] as const;

export type BlockedReason =
  | "device_locked"
  | "device_busy"
  | "login_required"
  | "rate_limit"
  | "unknown_block";

export class BlockedNativeAppError extends Error {
  constructor(readonly reason: BlockedReason) {
    super(`Native app blocked: ${reason}`);
    this.name = "BlockedNativeAppError";
  }
}

interface NativeRunnerModelConfig {
  modelSlug: string;
  nativeRunnerUrl: string;
  apiKey?: string;
  runId?: string;
  testKey?: string;
}

function modelSlugToApp(slug: string): string {
  if (!slug.startsWith(KORA_APP_PREFIX)) {
    throw new Error(
      `NativeRunnerModel expected a slug starting with "${KORA_APP_PREFIX}"; got "${slug}"`
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
 * Model that drives a real Android session against a native AI app via the
 * `kora-apps` native-runner HTTP service. Identical contract to
 * WebRunnerModel — only the URL and the slug suffix differ. The native-runner
 * serializes all sessions onto a single physical device, so callers should
 * sequence rather than fan-out.
 */
export function createNativeRunnerModel(
  config: NativeRunnerModelConfig
): Model {
  const app = modelSlugToApp(config.modelSlug);
  const runId = config.runId ?? randomUUID();
  const testKey = config.testKey ?? randomUUID();
  let sessionId: string | null = null;

  const headers: Record<string, string> = {"content-type": "application/json"};
  if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const r = await fetch(`${config.nativeRunnerUrl}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({runId, testKey, app}),
    });
    if (!r.ok) {
      throw new Error(
        `native-runner POST /sessions failed: ${r.status} ${await r.text()}`
      );
    }
    const data = (await r.json()) as {
      sessionId?: string;
      blockedReason?: BlockedReason;
    };
    if (data.blockedReason) throw new BlockedNativeAppError(data.blockedReason);
    if (!data.sessionId) {
      throw new Error("native-runner did not return sessionId");
    }
    sessionId = data.sessionId;
    return sessionId;
  }

  async function postTurn(text: string): Promise<string> {
    if (!sessionId) throw new Error("Session not open.");
    const r = await fetch(
      `${config.nativeRunnerUrl}/sessions/${sessionId}/turn`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({userMessage: text}),
      }
    );
    if (!r.ok) {
      throw new Error(
        `native-runner POST /sessions/${sessionId}/turn failed: ${r.status} ${await r.text()}`
      );
    }
    const data = (await r.json()) as {
      assistantMessage?: string;
      blockedReason?: BlockedReason;
    };
    if (data.blockedReason) throw new BlockedNativeAppError(data.blockedReason);
    if (typeof data.assistantMessage !== "string") {
      throw new Error("native-runner did not return assistantMessage");
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
        `kora-app:* native targets do not support structured output. Slug: ${config.modelSlug}`
      );
    },

    async dispose(outcome) {
      if (!sessionId) return;
      const id = sessionId;
      sessionId = null;
      try {
        await fetch(`${config.nativeRunnerUrl}/sessions/${id}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({outcome}),
        });
      } catch (err) {
        console.error(
          `native-runner DELETE /sessions/${id} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    },
  };
}

/** True for slugs that map to a native (on-device) target rather than a web one.
 * Convention: `kora-app-<name>-<platform>` where `<platform>` is one of
 * NATIVE_SUFFIXES (currently `-android`). Plain `kora-app-<name>` stays web. */
export function isNativeRunnerSlug(slug: string): boolean {
  if (!slug.startsWith(KORA_APP_PREFIX)) return false;
  return NATIVE_SUFFIXES.some(suffix => slug.endsWith(suffix));
}
