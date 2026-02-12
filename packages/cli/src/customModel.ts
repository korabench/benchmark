import {Scenario} from "@korabench/benchmark";
import {Model} from "./model.js";

export async function createCustomModel(
  modelSlug: string,
  _scenario: Scenario
): Promise<Model> {
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
