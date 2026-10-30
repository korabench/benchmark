import {
  JudgeModel,
  Scenario,
  TestContext,
  type ProfileRoles,
} from "@korabench/benchmark";
import * as R from "remeda";
import {createCustomModel} from "../../models/customModel.js";
import {createGatewayModel, GatewayModel} from "../../models/gatewayModel.js";
import {Model} from "../../models/model.js";
import {isNativeRunnerSlug} from "../../models/nativeRunnerModel.js";
import {isWebRunnerSlug} from "../../models/webRunnerModel.js";
import {createChildSimulator} from "./childSimulator.js";

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
  scenario: Scenario,
  language?: string,
  mechanismJudges?: readonly string[],
  childSimulator?: ProfileRoles["childSimulator"]
): Promise<BuiltContext> {
  if (childSimulator && language && language !== "English") {
    throw new Error("MIMESIS patch supports English conversations only.");
  }
  const targetModel = await (async () => {
    if (targetGatewayModel) {
      return targetGatewayModel;
    }

    return createCustomModel(targetModelSlug, scenario);
  })();

  const context: TestContext = {
    language,
    mechanismJudges,
    getUserResponse: async request => ({
      output: await userModel.getTextResponse(request),
    }),
    getAssistantResponse: async request => {
      if (!targetModel.getTextResponseWithReasoning) {
        return {output: await targetModel.getTextResponse(request)};
      }
      const {text, reasoning, reasoningTokens} =
        await targetModel.getTextResponseWithReasoning(request);
      return {output: text, reasoning, reasoningTokens};
    },
    judgeModels: R.mapValues(
      judgeModels,
      (model: Model): JudgeModel => ({
        getResponse: async request => ({
          output: await model.getStructuredResponse(request),
        }),
      })
    ),
  };
  if (childSimulator) {
    context.getChildResponse = createChildSimulator(userModel, {
      onOutcome: outcome =>
        console.error(
          `Child patch ${scenario.seed.id}: ${outcome.status}` +
            (outcome.endMarkerRedraws
              ? ` (${outcome.endMarkerRedraws} end-marker redraws)`
              : "")
        ),
    });
  }

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
): GatewayModel | undefined {
  if (
    targetModelSlug.startsWith("custom-") ||
    isWebRunnerSlug(targetModelSlug) ||
    isNativeRunnerSlug(targetModelSlug)
  ) {
    return undefined;
  }
  return createGatewayModel(modelsJsonPath, targetModelSlug);
}
