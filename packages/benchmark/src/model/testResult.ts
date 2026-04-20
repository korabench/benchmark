import {ModelMessage} from "@korabench/core";
import * as v from "valibot";
import {JudgeAssessment} from "./judgeAssessment.js";
import {MechanismAssessment} from "./mechanismAssessment.js";
import {Scenario} from "./scenario.js";
import {ScenarioPrompt} from "./scenarioPrompt.js";
import {TestAssessment} from "./testAssessment.js";

//
// Runtime type.
//

const VTestResult = v.strictObject({
  scenario: Scenario.io,
  prompt: ScenarioPrompt.io,
  messages: v.array(ModelMessage.io),
  assessment: TestAssessment.io,
  mechanismAssessment: MechanismAssessment.io,
  judgeAssessments: v.array(JudgeAssessment.io),
});

//
// Exports.
//

export interface TestResult extends v.InferOutput<typeof VTestResult> {}

export const TestResult = {
  io: VTestResult,
};
