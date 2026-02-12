import {ModelMessage} from "@korabench/core";
import * as v from "valibot";
import {BehaviorAssessment} from "./behaviorAssessment.js";
import {Scenario} from "./scenario.js";
import {ScenarioPrompt} from "./scenarioKey.js";
import {TestAssessment} from "./testAssessment.js";

//
// Runtime type.
//

const VTestResult = v.strictObject({
  scenario: Scenario.io,
  prompt: ScenarioPrompt.io,
  messages: v.array(ModelMessage.io),
  assessment: TestAssessment.io,
  behaviorAssessment: BehaviorAssessment.io,
});

//
// Exports.
//

export interface TestResult extends v.InferOutput<typeof VTestResult> {}

export const TestResult = {
  io: VTestResult,
};
