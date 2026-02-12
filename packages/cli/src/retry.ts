/**
 * Retry utilities for handling transient API failures with exponential backoff.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 5 */
  maxRetries?: number;
  /** Initial delay in milliseconds. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds. Default: 60000 */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff. Default: 2 */
  backoffMultiplier?: number;
  /** Jitter factor (0-1) to randomize delays. Default: 0.2 */
  jitterFactor?: number;
  /** Called before each retry with attempt info */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const defaultOptions: Required<Omit<RetryOptions, "onRetry">> = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

/**
 * Determines if an error is retryable based on its characteristics.
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Rate limiting
  if (message.includes("429") || message.includes("rate limit")) {
    return true;
  }

  // Server errors (5xx)
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("bad gateway") ||
    message.includes("service unavailable") ||
    message.includes("gateway timeout")
  ) {
    return true;
  }

  // Network/connection errors
  if (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("connection") ||
    name.includes("fetch") ||
    name.includes("network")
  ) {
    return true;
  }

  // Timeout errors
  if (message.includes("timeout") || name.includes("timeout")) {
    return true;
  }

  // Overloaded API
  if (message.includes("overloaded") || message.includes("capacity")) {
    return true;
  }

  // Validation/parsing errors - model returned malformed output
  if (
    name.includes("valibot") ||
    message.includes("invalid") ||
    message.includes("expected") ||
    message.includes("parsing") ||
    message.includes("validation")
  ) {
    return true;
  }

  // AI SDK output parsing errors
  if (
    message.includes("failed to parse") ||
    message.includes("json") ||
    message.includes("output")
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts retry-after delay from error if available.
 */
function getRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  // Check for retry-after in the error message or properties
  const errorAny = error as unknown as Record<string, unknown>;

  // Some APIs include headers in the error
  if (typeof errorAny.headers === "object" && errorAny.headers !== null) {
    const headers = errorAny.headers as Record<string, unknown>;
    const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
    if (typeof retryAfter === "string") {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }

  // Check for retryAfter property (some SDKs expose this directly)
  if (typeof errorAny.retryAfter === "number") {
    return errorAny.retryAfter * 1000;
  }

  return undefined;
}

/**
 * Calculates delay with exponential backoff and jitter.
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "onRetry">>,
  retryAfterMs?: number
): number {
  // Respect retry-after header if present
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }

  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);

  // Apply jitter
  const jitter = 1 + (Math.random() * 2 - 1) * options.jitterFactor;
  const delayWithJitter = exponentialDelay * jitter;

  return Math.min(delayWithJitter, options.maxDelayMs);
}

/**
 * Sleeps for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes an async function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = {...defaultOptions, ...options};
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this is not a retryable error
      if (!isRetryableError(error)) {
        throw lastError;
      }

      // Don't retry if we've exhausted all attempts
      if (attempt >= opts.maxRetries) {
        throw lastError;
      }

      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = calculateDelay(attempt, opts, retryAfterMs);

      if (options?.onRetry) {
        options.onRetry(attempt + 1, lastError, delayMs);
      }

      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error("Retry failed with no error");
}

/**
 * Creates a default onRetry handler that logs to stderr.
 */
export function createLogRetryHandler(
  context?: string
): NonNullable<RetryOptions["onRetry"]> {
  return (attempt, error, delayMs) => {
    const prefix = context ? `[${context}] ` : "";
    const delaySeconds = (delayMs / 1000).toFixed(1);
    console.error(
      `${prefix}Retry ${attempt}: ${error.message}. Waiting ${delaySeconds}s...`
    );
  };
}
