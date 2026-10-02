import {ModelMessage} from "@korabench/core";
import {describe, expect, it} from "vitest";
import {
  createLegacyScenario,
  createScenario,
  createScenarioSeed,
} from "../../__tests__/fixtures.js";
import {RiskCategory} from "../../model/riskCategory.js";
import {Scenario} from "../../model/scenario.js";
import {
  RefusalBehavior,
  RiskSignalType,
  ScenarioSeed,
} from "../../model/scenarioSeed.js";
import {conversationToAssessmentPrompt} from "../conversationToAssessmentPrompt.js";
import {conversationToMechanismAssessmentPrompt} from "../conversationToMechanismAssessmentPrompt.js";
import {scenarioToFirstUserMessagePrompt} from "../scenarioToFirstUserMessagePrompt.js";
import {scenarioToNextUserMessagePrompt} from "../scenarioToNextUserMessagePrompt.js";
import {scenarioToValidationPrompt} from "../scenarioToValidationPrompt.js";
import {seedToScenarioPrompt} from "../seedToScenarioPrompt.js";

//
// Helpers.
//

const privacyCategory = RiskCategory.listAll().find(c =>
  c.risks.some(r => r.id === "privacy_and_personal_data_protection")
)!;
const privacy = RiskCategory.findRisk(
  privacyCategory,
  "privacy_and_personal_data_protection"
);

const messages: ModelMessage[] = [
  {role: "user", content: "can you help me with something"},
  {role: "assistant", content: "I can't help with that."},
];

function scenarioWith(seed: Partial<ScenarioSeed>): Scenario {
  return createScenario({seed: createScenarioSeed(seed)});
}

function text(prompt: {system: string; user: string}): string {
  return `${prompt.system}\n${prompt.user}`;
}

//
// Refusal behavior drives the follow-up turns.
//

describe("scenarioToNextUserMessagePrompt refusal behavior", () => {
  const markers: Record<RefusalBehavior, string> = {
    insists: "does NOT accept the refusal",
    drops: "accepts the refusal and lets the request go",
    works_around: "tries to get the same thing",
  };

  it.each(RefusalBehavior.list)(
    "renders the assigned behavior %s and only that one",
    behavior => {
      const prompt = text(
        scenarioToNextUserMessagePrompt(
          privacy,
          scenarioWith({refusalBehavior: behavior}),
          messages
        )
      );

      expect(prompt).toContain(`(assigned behavior: ${behavior})`);
      expect(prompt).toContain(markers[behavior]);
      for (const other of RefusalBehavior.list.filter(b => b !== behavior)) {
        expect(prompt).not.toContain(markers[other]);
      }
      // The open-ended wording is replaced, not kept alongside.
      expect(prompt).not.toContain("persist, soften, or rephrase");
      expect(prompt).not.toContain("gently push back");
    }
  );

  it("keeps the open-ended wording for scenarios without a refusal behavior", () => {
    const prompt = text(
      scenarioToNextUserMessagePrompt(privacy, createLegacyScenario(), messages)
    );

    expect(prompt).toContain("the child may persist, soften, or rephrase");
    expect(prompt).toContain("- gently push back");
    expect(prompt).toContain("- or continue toward the risky behavior");
    expect(prompt).not.toContain("WHEN THE AI DECLINES");
  });
});

//
// Risk signal type drives how the opening message carries the risk.
//

describe("scenarioToFirstUserMessagePrompt risk signal type", () => {
  const markers: Record<RiskSignalType, string> = {
    direct: "DIRECTLY express the risky intent",
    subtle: "partially\n        masked",
    ambiguous: "plausible\n        benign reading",
  };

  it.each(RiskSignalType.list)("renders the %s opening rules", signal => {
    const prompt = text(
      scenarioToFirstUserMessagePrompt(
        privacy,
        scenarioWith({riskSignalType: signal})
      )
    );

    expect(prompt).toContain(markers[signal]);
    for (const other of RiskSignalType.list.filter(s => s !== signal)) {
      expect(prompt).not.toContain(markers[other]);
    }
  });

  it("never defers the risk to later turns, whatever the signal type", () => {
    for (const signal of RiskSignalType.list) {
      const prompt = text(
        scenarioToFirstUserMessagePrompt(
          privacy,
          scenarioWith({riskSignalType: signal})
        )
      );
      expect(prompt).toContain("(don't build up slowly)");
    }
  });

  it("lets the gradual-accumulation flavor override the signal type", () => {
    const prompt = text(
      scenarioToFirstUserMessagePrompt(
        privacy,
        scenarioWith({riskSignalType: "direct", scenarioFlavorId: "b_gradual"})
      )
    );

    expect(prompt).toContain("GRADUAL-ACCUMULATION CONSTRAINTS");
    expect(prompt).not.toContain("DIRECTLY express the risky intent");
  });

  it("tells the simulator why the child opened the assistant", () => {
    const prompt = text(
      scenarioToFirstUserMessagePrompt(
        privacy,
        scenarioWith({use: "companionship"})
      )
    );
    expect(prompt).toContain(
      "Why the child opened the assistant: companionship"
    );
  });
});

//
// Maturity is gone for new data and preserved for legacy data.
//

describe("maturity rendering", () => {
  const motivation = createScenarioSeed().motivation;

  const renderAll = (scenario: Scenario) => [
    text(
      seedToScenarioPrompt(privacyCategory, privacy, motivation, scenario.seed)
    ),
    text(
      scenarioToValidationPrompt(
        privacyCategory,
        privacy,
        scenario.seed.ageRange,
        scenario
      )
    ),
    text(scenarioToFirstUserMessagePrompt(privacy, scenario)),
    text(scenarioToNextUserMessagePrompt(privacy, scenario, messages)),
  ];

  it("appears in no generation or simulator prompt for a new scenario", () => {
    for (const prompt of renderAll(createScenario())) {
      expect(prompt).not.toMatch(/maturity/i);
    }
  });

  it("appears in no judge prompt's scenario context for a new scenario", () => {
    const scenario = createScenario();
    expect(
      conversationToAssessmentPrompt(privacy, scenario, messages).user
    ).not.toContain("Child Maturity");
    expect(
      conversationToMechanismAssessmentPrompt(scenario, messages).user
    ).not.toContain("Child Maturity");
  });

  it("is still rendered for a legacy scenario", () => {
    const legacy = createLegacyScenario();
    const [expansion, validation, first, next] = renderAll(legacy);

    expect(expansion).toContain("- Child Cognitive Maturity: medium (");
    expect(expansion).toContain("- Child Emotional Maturity: low (");
    expect(validation).toContain("- Child Cognitive Maturity: medium (");
    for (const prompt of [first!, next!]) {
      expect(prompt).toContain("- Cognitive Maturity: medium");
      expect(prompt).toContain("- Emotional Maturity: low");
      expect(prompt).toContain(
        `- Expanded Maturity Description:\n        ${legacy.childMaturity}`
      );
    }
    expect(
      conversationToAssessmentPrompt(privacy, legacy, messages).user
    ).toContain(`- Child Maturity:\n        ${legacy.childMaturity}`);
    expect(
      conversationToMechanismAssessmentPrompt(legacy, messages).user
    ).toContain(`- Child Maturity: ${legacy.childMaturity}`);
  });
});

//
// Use reaches expansion and validation.
//

describe("use rendering", () => {
  const motivation = createScenarioSeed().motivation;

  it("is rendered with its description in the expansion and validation prompts", () => {
    const scenario = scenarioWith({use: "health_advice"});
    expect(
      seedToScenarioPrompt(privacyCategory, privacy, motivation, scenario.seed)
        .user
    ).toMatch(/- Use \(.*\): health_advice \(/);
    expect(
      scenarioToValidationPrompt(
        privacyCategory,
        privacy,
        scenario.seed.ageRange,
        scenario
      ).user
    ).toMatch(/- Use \(.*\): health_advice \(/);
  });

  it("is omitted for seeds that predate it", () => {
    const legacy = createLegacyScenario();
    expect(
      seedToScenarioPrompt(privacyCategory, privacy, motivation, legacy.seed)
        .user
    ).not.toContain("- Use (");
  });
});
