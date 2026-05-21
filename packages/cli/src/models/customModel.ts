import {Scenario} from "@korabench/benchmark";
import {Model} from "./model.js";
import {
  createNativeRunnerModel,
  isNativeRunnerSlug,
} from "./nativeRunnerModel.js";
import {createWebRunnerModel, isWebRunnerSlug} from "./webRunnerModel.js";

const DEFAULT_WEB_RUNNER_URL = "http://localhost:7100";
const DEFAULT_NATIVE_RUNNER_URL = "http://localhost:7200";

export async function createCustomModel(
  modelSlug: string,
  _scenario: Scenario
): Promise<Model> {
  if (isNativeRunnerSlug(modelSlug)) {
    const nativeRunnerUrl =
      process.env.NATIVE_RUNNER_URL ?? DEFAULT_NATIVE_RUNNER_URL;
    const apiKey = process.env.NATIVE_RUNNER_API_KEY;
    return createNativeRunnerModel({modelSlug, nativeRunnerUrl, apiKey});
  }
  if (isWebRunnerSlug(modelSlug)) {
    const webRunnerUrl = process.env.WEB_RUNNER_URL ?? DEFAULT_WEB_RUNNER_URL;
    const apiKey = process.env.WEB_RUNNER_API_KEY;
    return createWebRunnerModel({modelSlug, webRunnerUrl, apiKey});
  }

  return {
    async getTextResponse() {
      throw new Error(
        `Custom model "${modelSlug}" is not implemented. ` +
          `Provide an implementation in customModel.ts.`
      );
    },

    async getStructuredResponse() {
      throw new Error(
        `Custom model "${modelSlug}" is not implemented. ` +
          `Provide an implementation in customModel.ts.`
      );
    },
  };
}
