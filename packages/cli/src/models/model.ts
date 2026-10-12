import {ModelRequest, TypedModelRequest} from "@korabench/core";

export interface StructuredRequest<T> extends TypedModelRequest<T> {
  /**
   * Requests with the same key share a long, identical system prompt; the
   * gateway model turns it into the provider's prompt-caching hint.
   */
  promptCacheKey?: string;
}

export interface Model {
  getTextResponse(request: ModelRequest): Promise<string>;
  getStructuredResponse<T>(request: StructuredRequest<T>): Promise<T>;
  /**
   * Optional cleanup hook. Models backed by long-lived resources (browser
   * sessions, Browserbase reservations) implement this so the CLI can release
   * them in a try/finally around `kora.runTest`. Gateway-only Models leave
   * this undefined.
   */
  dispose?(outcome: "completed" | "errored"): Promise<void>;
}
