import {ModelRequest, TypedModelRequest} from "@korabench/core";

export interface StructuredRequest<T> extends TypedModelRequest<T> {
  /**
   * Requests with the same key share a long, identical system prompt; the
   * gateway model turns it into the provider's prompt-caching hint.
   */
  promptCacheKey?: string;
}

/** A text answer with the reasoning the provider returned alongside it. */
export interface ReasonedTextResponse {
  text: string;
  /** Reasoning text as the provider returned it (summary or raw trace). */
  reasoning?: string;
  /** Reasoning tokens billed for the answer, when reported. */
  reasoningTokens?: number;
}

export interface Model {
  getTextResponse(request: ModelRequest): Promise<string>;
  /**
   * Optional: the answer plus the model's reasoning, asking the provider to
   * return the reasoning text where thinking is already on. Never turns
   * thinking on. Only the tested model is called this way.
   */
  getTextResponseWithReasoning?(
    request: ModelRequest
  ): Promise<ReasonedTextResponse>;
  getStructuredResponse<T>(request: StructuredRequest<T>): Promise<T>;
  /**
   * Optional cleanup hook. Models backed by long-lived resources (browser
   * sessions, Browserbase reservations) implement this so the CLI can release
   * them in a try/finally around `kora.runTest`. Gateway-only Models leave
   * this undefined.
   */
  dispose?(outcome: "completed" | "errored"): Promise<void>;
}
