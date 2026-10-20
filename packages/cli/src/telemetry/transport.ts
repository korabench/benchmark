import type {Settings} from "./settings.js";

export const collectorUrl = "https://korabench.ai/api/telemetry/v1";
export type Credentials = NonNullable<Settings["credentials"]>;

/** No retries, redirects, persistent queue, or payload/error logging. */
export class TelemetryTransport {
  private readonly requests = new Map<Promise<boolean>, AbortController>();
  constructor(
    private readonly baseUrl = collectorUrl,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  send(
    operation: "events" | "identify" | "installation",
    credentials: Credentials,
    body?: unknown
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const request = Promise.resolve()
      .then(() =>
        this.fetcher(`${this.baseUrl}/${operation}`, {
          method: operation === "installation" ? "DELETE" : "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credentials.secret}`,
            ...(body
              ? {"Content-Type": "application/json"}
              : {"X-Kora-Installation-Id": credentials.installationId}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      )
      .then(async response => {
        await response.body?.cancel();
        return response.status === 204;
      })
      .catch(() => false)
      .finally(() => {
        clearTimeout(timeout);
        this.requests.delete(request);
      });
    this.requests.set(request, controller);
    return request;
  }

  cancel(): void {
    for (const controller of this.requests.values()) controller.abort();
  }
}
