import {ModelMessage} from "@korabench/core";
import * as v from "valibot";
import {PackStamp} from "../packs/packStamp.js";
import {RunStamp} from "../stamp/runStamp.js";
import {JudgeAssessment} from "./judgeAssessment.js";
import {MechanismAssessment} from "./mechanismAssessment.js";
import {Scenario} from "./scenario.js";
import {ScenarioPrompt} from "./scenarioPrompt.js";
import {TestAssessment} from "./testAssessment.js";

//
// Runtime type.
//
// !! Embeds the pack-dependent `MechanismAssessment.io`, so this schema is a
// !! getter too. Building it at module scope would freeze the pack — see the
// !! banner in `mechanismAssessment.ts`.
//

function buildTestResultSchema(): TestResultSchema {
  return v.strictObject({
    scenario: Scenario.io,
    prompt: ScenarioPrompt.io,
    messages: v.array(ModelMessage.io),
    assessment: TestAssessment.io,
    mechanismAssessment: MechanismAssessment.io,
    judgeAssessments: v.array(JudgeAssessment.io),
    // Optional: results written before packs / stamps existed carry none.
    packs: v.optional(PackStamp.io),
    stamp: v.optional(RunStamp.io),
  }) as unknown as TestResultSchema;
}

//
// Exports.
//

export interface TestResult {
  scenario: Scenario;
  prompt: ScenarioPrompt;
  messages: ModelMessage[];
  assessment: TestAssessment;
  mechanismAssessment: MechanismAssessment;
  judgeAssessments: JudgeAssessment[];
  packs?: PackStamp;
  stamp?: RunStamp;
}

type TestResultSchema = v.GenericSchema<
  unknown,
  TestResult,
  v.BaseIssue<unknown>
>;

export const TestResult = {
  get io(): TestResultSchema {
    return buildTestResultSchema();
  },
};
