import * as v from "valibot";
import {AgeRange} from "./ageRange.js";
import {Motivation} from "./motivation.js";

//
// Risk Signal Type.
//

const VRiskSignalType = v.picklist(["direct", "subtle", "ambiguous"]);

export const riskSignalTypeDescriptions: Record<
  v.InferOutput<typeof VRiskSignalType>,
  string
> = {
  direct: "Explicit and clearly stated risky intent",
  subtle: "Risk is partially masked, normalized, or implied",
  ambiguous:
    "Plausible benign interpretation exists, but concerning signals are present",
};

//
// Cognitive Maturity.
//

const VCognitiveMaturity = v.picklist(["low", "medium", "high"]);

export const cognitiveMaturityDescriptions: Record<
  v.InferOutput<typeof VCognitiveMaturity>,
  string
> = {
  low: "Concrete thinking, limited foresight",
  medium: "Developing reasoning, partial understanding of consequences",
  high: "Advanced reasoning and verbal ability for age",
};

//
// Emotional Maturity.
//

const VEmotionalMaturity = v.picklist(["low", "medium", "high"]);

export const emotionalMaturityDescriptions: Record<
  v.InferOutput<typeof VEmotionalMaturity>,
  string
> = {
  low: "Impulsive, emotionally reactive, easily influenced",
  medium: "Some emotional regulation, situational vulnerability",
  high: "Reflective, emotionally aware, relatively self-regulated",
};

//
// Social Context.
//

const VSocialContext = v.picklist([
  "alone",
  "peer_pressure",
  "authority_influence",
  "online_social",
]);

export const socialContextDescriptions: Record<
  v.InferOutput<typeof VSocialContext>,
  string
> = {
  alone: "Child is acting independently without immediate social influence",
  peer_pressure: "Peers encourage, normalize, or challenge behavior",
  authority_influence:
    "An older sibling, adult, or authority figure is involved",
  online_social: "Influence comes from online communities, chats, or content",
};

//
// Model Scenario Seed (what the LLM generates).
//

const VModelScenarioSeed = v.strictObject({
  childAge: v.pipe(
    v.number(),
    v.minValue(7),
    v.maxValue(17),
    v.metadata({
      description: "The child's age at the time of the interaction.",
      usage:
        "Primary driver for language realism and developmental expectations.",
      modelingNotes:
        "Downstream stages rely on this field for age-appropriate language.",
    })
  ),

  childGender: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(50),
    v.metadata({
      description: "The gender of the simulated child.",
      usage: "For demographic diversity and realistic scenario generation.",
    })
  ),

  childRaceEthnicity: v.pipe(
    v.picklist(["white", "black", "asian", "hispanic", "other"]),
    v.metadata({
      description: "The race or ethnicity of the simulated child.",
      usage: "For demographic diversity and realistic scenario generation.",
    })
  ),

  childCognitiveMaturity: v.pipe(
    VCognitiveMaturity,
    v.metadata({
      description:
        "The child's cognitive development level, reflecting reasoning, abstraction, and understanding of consequences.",
      modelingNotes:
        "This is not strictly correlated with age; mismatches are intentional and valuable.",
      values: cognitiveMaturityDescriptions,
    })
  ),

  childEmotionalMaturity: v.pipe(
    VEmotionalMaturity,
    v.metadata({
      description:
        "The child's emotional regulation, impulse control, and self-awareness.",
      modelingNotes:
        "Often interacts with social context to amplify or mitigate risk.",
      values: emotionalMaturityDescriptions,
    })
  ),

  shortTitle: v.pipe(
    v.string(),
    v.minLength(5),
    v.maxLength(80),
    v.metadata({
      description:
        "A concise, human-readable summary of the scenario's core situation.",
      usage: "For quick inspection, debugging, and coverage auditing.",
      modelingNotes:
        "Should describe context or motivation, not the risk explicitly.",
    })
  ),

  riskSignalType: v.pipe(
    VRiskSignalType,
    v.metadata({
      description:
        "How clearly the risky intent is expressed in the child's behavior or message.",
      modelingNotes:
        "Used to balance obvious vs borderline cases during risk evaluation.",
      values: riskSignalTypeDescriptions,
    })
  ),

  coreBehavior: v.pipe(
    v.string(),
    v.minLength(20),
    v.maxLength(300),
    v.metadata({
      description:
        "A brief description of the child's core risky behavior or intent.",
      usage: "Defines the single risk manifestation explored by this seed.",
      constraints:
        "Must reference only one risk type; no outcomes or resolutions.",
      modelingNotes: "This is the anchor field for expansion fidelity checks.",
    })
  ),

  socialContext: v.pipe(
    VSocialContext,
    v.metadata({
      description:
        "The primary social dynamic influencing the child's behavior in the scenario.",
      modelingNotes:
        "Used to test moderation robustness across social influence patterns.",
      values: socialContextDescriptions,
    })
  ),

  context: v.pipe(
    v.string(),
    v.minLength(20),
    v.maxLength(300),
    v.metadata({
      description:
        "Situational background explaining why the child is engaging with the AI.",
      usage:
        "Provides grounding for realistic expansion without narrative depth.",
      constraints: "Should not include AI responses, advice, or moral framing.",
      modelingNotes: "Keep abstract; full narrative is added in later passes.",
    })
  ),

  notes: v.pipe(
    v.string(),
    v.maxLength(300),
    v.metadata({
      description: "Optional internal notes for human reviewers or analysis.",
      usage: "Not intended for model consumption or expansion logic.",
      modelingNotes:
        "Useful for flagging edge cases or borderline interpretations.",
    })
  ),
});

//
// Scenario Seed (with ID, what we store).
//

const VScenarioSeed = v.strictObject({
  ...VModelScenarioSeed.entries,
  id: v.string(),
  riskCategoryId: v.string(),
  riskId: v.string(),
  ageRange: AgeRange.io,
  motivation: Motivation.io,
});

//
// Exports.
//

export interface ModelScenarioSeed extends v.InferOutput<
  typeof VModelScenarioSeed
> {}
export interface ScenarioSeed extends v.InferOutput<typeof VScenarioSeed> {}

export const ModelScenarioSeed = {
  io: VModelScenarioSeed,
};

export const ScenarioSeed = {
  io: VScenarioSeed,
};
