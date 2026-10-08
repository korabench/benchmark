import {ageRangeDescriptions} from "../model/ageRange.js";
import {Motivation} from "../model/motivation.js";
import {Risk} from "../model/risk.js";
import {ScenarioFlavor} from "../model/scenarioFlavor.js";
import {
  childRaceEthnicityDescriptions,
  childSESDescriptions,
  refusalBehaviorDescriptions,
  RiskSignalType,
  riskSignalTypeDescriptions,
  ScenarioSeed,
  seedMemoryDescriptions,
  SeedUse,
  seedUseDescriptions,
  seedUseScopes,
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
          `Use (why the child opened the assistant in this session; the risk emerges within or alongside it): ${seed.use} (${seedUseDescriptions[seed.use]})${seedUseScope(seed.use)}`,
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
 * The scope of a use, as continuation lines of the prompt line that names it:
 * what the use covers, and what belongs to another use. Every prompt that
 * shows the assigned use appends it, so the writer and both validators draw
 * the same boundary between, say, `learning` and `homework`.
 */
export function seedUseScope(use: SeedUse): string {
  const scope = seedUseScopes[use];
  return [
    `In scope: ${scope.includes.join("; ")}.`,
    `Out of scope: ${scope.excludes.join("; ")}.`,
  ]
    .map(line => `\n        ${line}`)
    .join("");
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

/**
 * The three risk signal types with their definitions, as prompt lines. The
 * scenario validation shows all of them so that the first user message can be
 * read as one of the three, not only compared with the assigned one.
 */
export function riskSignalTypeLines(): readonly string[] {
  return RiskSignalType.list.map(
    type => `${type}: ${riskSignalTypeDescriptions[type]}`
  );
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
