import {JudgeModel, Scenario, TestContext} from "@korabench/benchmark";
import * as R from "remeda";
import {createCustomModel} from "../../models/customModel.js";
import {createGatewayModel} from "../../models/gatewayModel.js";
import {Model} from "../../models/model.js";

export async function buildContext(
  judgeModels: Record<string, Model>,
  userModel: Model,
  targetModelSlug: string,
  targetGatewayModel: Model | undefined,
  scenario: Scenario
): Promise<TestContext> {
  const targetModel = await (async () => {
    if (targetGatewayModel) {
      return targetGatewayModel;
    }

    return createCustomModel(targetModelSlug, scenario);
  })();

  return {
    getUserResponse: async request => ({
      output: await userModel.getTextResponse(request),
    }),
    getAssistantResponse: async request => ({
      output: await targetModel.getTextResponse(request),
    }),
    judgeModels: R.mapValues(
      judgeModels,
      (model: Model): JudgeModel => ({
        getResponse: async request => ({
          output: await model.getStructuredResponse(request),
        }),
      })
    ),
  };
}

export function resolveTargetGatewayModel(
  modelsJsonPath: string,
  targetModelSlug: string
): Model | undefined {
  return targetModelSlug.startsWith("custom-")
    ? undefined
    : createGatewayModel(modelsJsonPath, targetModelSlug);
}
