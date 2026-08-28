import {ModelMessage} from "@korabench/core";
import {describe, expect, it} from "vitest";
import {
  createScenario,
  testRiskCategoryId,
  testRiskId,
} from "../../__tests__/fixtures.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {conversationToAssessmentPrompt} from "../conversationToAssessmentPrompt.js";
import {conversationToMechanismAssessmentPrompt} from "../conversationToMechanismAssessmentPrompt.js";
import {
  judgeLanguageSection,
  userMessageLanguageSection,
} from "../languageSections.js";
import {scenarioToFirstUserMessagePrompt} from "../scenarioToFirstUserMessagePrompt.js";
import {scenarioToNextUserMessagePrompt} from "../scenarioToNextUserMessagePrompt.js";

//
// Helpers.
//

const riskCategory = RiskCategory.find(testRiskCategoryId);
const risk = RiskCategory.findRisk(riskCategory, testRiskId);

const messages: readonly ModelMessage[] = [
  {role: "user", content: "Hello, can you help me with something?"},
  {role: "assistant", content: "Of course, what do you need help with?"},
];

//
// Tests.
//

describe("userMessageLanguageSection", () => {
  it("is empty for English and for absent language", () => {
    expect(userMessageLanguageSection("en")).toBe("");
    expect(userMessageLanguageSection(undefined)).toBe("");
  });

  it("names the language for non-English", () => {
    const section = userMessageLanguageSection("fr");
    expect(section).toContain("LANGUAGE REQUIREMENT");
    expect(section).toContain("French");
  });
});

describe("judgeLanguageSection", () => {
  it("is empty for English and for absent language", () => {
    expect(judgeLanguageSection("en")).toBe("");
    expect(judgeLanguageSection(undefined)).toBe("");
  });

  it("names the language for non-English", () => {
    const section = judgeLanguageSection("fr");
    expect(section).toContain("CONVERSATION LANGUAGE");
    expect(section).toContain("French");
  });
});

describe("user message prompts with scenario language", () => {
  it("keeps English prompts identical whether language is absent or 'en'", () => {
    const absent = createScenario();
    const english = createScenario({language: "en"});

    expect(scenarioToFirstUserMessagePrompt(risk, english)).toEqual(
      scenarioToFirstUserMessagePrompt(risk, absent)
    );
    expect(scenarioToNextUserMessagePrompt(risk, english, messages)).toEqual(
      scenarioToNextUserMessagePrompt(risk, absent, messages)
    );
  });

  it("adds the language requirement for French scenarios", () => {
    const french = createScenario({language: "fr"});

    const first = scenarioToFirstUserMessagePrompt(risk, french);
    expect(first.system).toContain("LANGUAGE REQUIREMENT");
    expect(first.system).toContain("French");

    const next = scenarioToNextUserMessagePrompt(risk, french, messages);
    expect(next.system).toContain("LANGUAGE REQUIREMENT");
    expect(next.system).toContain("French");
  });
});

describe("judge prompts with scenario language", () => {
  it("keeps English prompts identical whether language is absent or 'en'", () => {
    const absent = createScenario();
    const english = createScenario({language: "en"});

    expect(conversationToAssessmentPrompt(risk, english, messages)).toEqual(
      conversationToAssessmentPrompt(risk, absent, messages)
    );
    expect(conversationToMechanismAssessmentPrompt(english, messages)).toEqual(
      conversationToMechanismAssessmentPrompt(absent, messages)
    );
  });

  it("tells judges the conversation language for French scenarios", () => {
    const french = createScenario({language: "fr"});

    const assessment = conversationToAssessmentPrompt(risk, french, messages);
    expect(assessment.system).toContain("CONVERSATION LANGUAGE");
    expect(assessment.system).toContain("French");

    const mechanism = conversationToMechanismAssessmentPrompt(french, messages);
    expect(mechanism.system).toContain("CONVERSATION LANGUAGE");
    expect(mechanism.system).toContain("French");
  });
});
