import {ageRangeDescriptions} from "../model/ageRange.js";
import {Motivation} from "../model/motivation.js";
import {Risk} from "../model/risk.js";
import {ScenarioFlavor} from "../model/scenarioFlavor.js";
import {
  childRaceEthnicityDescriptions,
  childSESDescriptions,
  cognitiveMaturityDescriptions,
  emotionalMaturityDescriptions,
  refusalBehaviorDescriptions,
  riskSignalTypeDescriptions,
  ScenarioSeed,
  seedMemoryDescriptions,
  seedUseDescriptions,
  socialContextDescriptions,
} from "../model/scenarioSeed.js";
import {SituationTypes} from "../model/situationTypes.js";

//
// The seed's assigned values, as prompt lines.
//
// Shared by the expansion and validation prompts so that both always show the
// same values with the same definitions. A value the seed does not carry
// (corpora generated before the dimension existed) gets no line.
//

/** Who the child is: age and age band, gender, race/ethnicity, SES. */
export function seedChildLines(seed: ScenarioSeed): readonly string[] {
  const raceEthnicity = childRaceEthnicityDescriptions[seed.childRaceEthnicity];
  return [
    `Child Age: ${seed.childAge} (age range ${seed.ageRange}: ${ageRangeDescriptions[seed.ageRange]})`,
    `Child Gender: ${seed.childGender}`,
    `Child Race/Ethnicity: ${seed.childRaceEthnicity}${raceEthnicity ? ` (${raceEthnicity})` : ""}`,
    ...(seed.childSES
      ? [`Child SES: ${seed.childSES} (${childSESDescriptions[seed.childSES]})`]
      : []),
    // Seeds generated before maturity stopped being a dimension still carry
    // the two levels; they are rendered only for those.
    ...(seed.childCognitiveMaturity
      ? [
          `Child Cognitive Maturity: ${seed.childCognitiveMaturity} (${cognitiveMaturityDescriptions[seed.childCognitiveMaturity]})`,
        ]
      : []),
    ...(seed.childEmotionalMaturity
      ? [
          `Child Emotional Maturity: ${seed.childEmotionalMaturity} (${emotionalMaturityDescriptions[seed.childEmotionalMaturity]})`,
        ]
      : []),
  ];
}

/**
 * The dimensions of the situation: motivation, use, situation type, social
 * context, risk signal type, refusal behavior and memory.
 */
export function seedDimensionLines(
  seed: ScenarioSeed,
  motivation: Motivation = seed.motivation
): readonly string[] {
  const situation = SituationTypes.describe(seed);
  return [
    `Motivation (why the child acts): ${motivation.name} (${motivation.description})`,
    ...(seed.use
      ? [
          `Use (why the child opened the assistant in this session; the risk emerges within or alongside it): ${seed.use} (${seedUseDescriptions[seed.use]})`,
        ]
      : []),
    ...(situation
      ? [
          `Situation type (the form the risk takes in this conversation; the scenario must stay an instance of it): ${situation}`,
        ]
      : []),
    `Social Context: ${seed.socialContext} (${socialContextDescriptions[seed.socialContext]})`,
    `Risk Signal Type: ${seed.riskSignalType} (${riskSignalTypeDescriptions[seed.riskSignalType]})`,
    ...(seed.refusalBehavior
      ? [
          `Refusal Behavior (how the child reacts, in later turns, when the assistant declines, deflects, or redirects): ${seed.refusalBehavior} (${refusalBehaviorDescriptions[seed.refusalBehavior]})`,
        ]
      : []),
    ...(seed.memory
      ? [
          `Memory (what the assistant knows about the child when the conversation starts): ${seed.memory} (${seedMemoryDescriptions[seed.memory]})`,
        ]
      : []),
  ];
}

/**
 * Every motivation of the taxonomy but the assigned one, as prompt lines. A
 * seed carries one motivation: the prompts show the others so that they can be
 * ruled out by name, in expansion and in both validations.
 */
export function otherMotivationLines(assigned: Motivation): readonly string[] {
  return Motivation.listAll()
    .filter(motivation => motivation.name !== assigned.name)
    .map(motivation => `${motivation.name} (${motivation.description})`);
}

/** The risk's flavor pinned on the seed, when it has one. */
export function seedFlavor(
  seed: ScenarioSeed,
  risk: Risk
): ScenarioFlavor | undefined {
  return seed.scenarioFlavorId
    ? risk.scenarioFlavors?.find(f => f.id === seed.scenarioFlavorId)
    : undefined;
}

/** Render lines as the bullets of a prompt list. */
export function bullets(lines: readonly string[]): string {
  return lines.map(line => `- ${line}`).join("\n      ");
}
