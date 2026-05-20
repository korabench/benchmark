import {ModelRequest, TypedModelRequest} from "@korabench/core";

export interface Model {
  getTextResponse(request: ModelRequest): Promise<string>;
  getStructuredResponse<T>(request: TypedModelRequest<T>): Promise<T>;
  /**
   * Optional cleanup hook. Models backed by long-lived resources (browser
   * sessions, Browserbase reservations) implement this so the CLI can release
   * them in a try/finally around `kora.runTest`. Gateway-only Models leave
   * this undefined.
   */
  dispose?(outcome: "completed" | "errored"): Promise<void>;
}
