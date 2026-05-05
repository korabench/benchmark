import {Scenario} from "@korabench/benchmark";
import {Model} from "./model.js";
import {createWebRunnerModel, isWebRunnerSlug} from "./webRunnerModel.js";

const DEFAULT_WEB_RUNNER_URL = "http://localhost:7100";

export async function createCustomModel(
  modelSlug: string,
  _scenario: Scenario
): Promise<Model> {
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
