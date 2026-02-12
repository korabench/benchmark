import {ModelRequest} from "@korabench/core";
import {RetryOptions, withRetry} from "./retry.js";

export async function getCustomTextResponse(
  modelSlug: string,
  _request: ModelRequest,
  retryOptions: RetryOptions
): Promise<string> {
  return withRetry(async () => {
    throw new Error(
      `Custom model "${modelSlug}" is not implemented. ` +
        `Provide an implementation in customModel.ts.`
    );
  }, retryOptions);
}
