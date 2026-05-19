import {JudgeModel, Scenario, TestContext} from "@korabench/benchmark";
import * as R from "remeda";
import {createCustomModel} from "../../models/customModel.js";
import {createGatewayModel} from "../../models/gatewayModel.js";
import {Model} from "../../models/model.js";
import {isWebRunnerSlug} from "../../models/webRunnerModel.js";

export interface BuiltContext {
  context: TestContext;
  /** Tear down the target model (e.g., release the web-runner browser
   * session). Always safe to call; idempotent. */
  dispose: (outcome: "completed" | "errored") => Promise<void>;
}

export async function buildContext(
  judgeModels: Record<string, Model>,
  userModel: Model,
  targetModelSlug: string,
  targetGatewayModel: Model | undefined,
  scenario: Scenario
): Promise<BuiltContext> {
  const targetModel = await (async () => {
    if (targetGatewayModel) {
      return targetGatewayModel;
    }

    return createCustomModel(targetModelSlug, scenario);
  })();

  const context: TestContext = {
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

  return {
    context,
    async dispose(outcome) {
      // Only the targetModel is expected to hold disposable resources today
      // (e.g., the WebRunnerModel keeps a browser session). Gateway models
      // are stateless and have no `dispose`.
      if (targetModel.dispose) {
        await targetModel.dispose(outcome);
      }
    },
  };
}

export function resolveTargetGatewayModel(
  modelsJsonPath: string,
  targetModelSlug: string
): Model | undefined {
  if (
    targetModelSlug.startsWith("custom-") ||
    isWebRunnerSlug(targetModelSlug)
  ) {
    return undefined;
  }
  return createGatewayModel(modelsJsonPath, targetModelSlug);
}
