import {RiskSignalType, ScenarioSeed, SeedUse} from "./scenarioSeed.js";
import {SituationMask} from "./situationMask.js";

//
// Relabeling a stuck seed.
//
// The corpus must hold one scenario per seed. A seed whose text cannot carry
// an assigned value, however often it is written again, would otherwise
// block the whole output. The situation mask rules out the pairs the
// definitions contradict, but it cannot see every such pair ahead of a
// corpus, and a corpus allocated before a rule still holds the pair. So
// `expand-scenarios` moves the value, once per dimension, and records the
// assigned value on the seed (`relabeled`) and in the validation ledger:
//
// - the risk signal type, when every attempt answered no to
//   `firstMessageShowsSignalType`, to the nearest value the situation type
//   allows. Of the dimensions, the signal type is the one whose counts may
//   give way (SCENARIO_CREATION.md, "Situation mask"). Nearest first:
//   `ambiguous` and `direct` each move to `subtle`, which keeps the situation
//   fully present and only changes its emphasis; `subtle` moves to `direct`.
// - the use, when every attempt answered no to `showsUse` or
//   `firstMessageShowsUse` and the mask forbids the pair and names the use
//   the session is (`relabelTo`). A pair the mask allows stays as it is: a
//   seed stuck on it is a bug to look at, not a value to move.
//

const NEAREST: Record<RiskSignalType, readonly RiskSignalType[]> = {
  ambiguous: ["subtle", "direct"],
  direct: ["subtle", "ambiguous"],
  subtle: ["direct", "ambiguous"],
};

/**
 * The seed with its risk signal type moved to the nearest value its situation
 * type allows, and the assigned value kept under `relabeled`. Undefined when
 * the signal type was relabeled already, or when no other value is allowed.
 */
export function relabelSignalType(
  seed: ScenarioSeed,
  mask: SituationMask = SituationMask.bundled()
): ScenarioSeed | undefined {
  if (seed.relabeled?.riskSignalType) {
    return undefined;
  }
  const to = NEAREST[seed.riskSignalType].find(
    value =>
      seed.situationType === undefined ||
      SituationMask.allowsRiskSignalType(
        mask,
        seed.riskId,
        seed.situationType,
        value
      )
  );
  return to === undefined
    ? undefined
    : {
        ...seed,
        riskSignalType: to,
        relabeled: {
          ...seed.relabeled,
          riskSignalType: {from: seed.riskSignalType},
        },
      };
}

/**
 * The seed with its use moved to the one the situation mask names for its
 * situation type, and the assigned use kept under `relabeled`. Undefined when
 * the use was relabeled already, when the seed carries no use or situation
 * type, or when the mask allows the pair or names no replacement.
 */
export function relabelUse(
  seed: ScenarioSeed,
  mask: SituationMask = SituationMask.bundled()
): ScenarioSeed | undefined {
  if (seed.relabeled?.use || seed.use === undefined || !seed.situationType) {
    return undefined;
  }
  const to: SeedUse | undefined = SituationMask.relabeledUseFor(
    mask,
    seed.riskId,
    seed.situationType,
    seed.use
  );
  return to === undefined
    ? undefined
    : {
        ...seed,
        use: to,
        relabeled: {...seed.relabeled, use: {from: seed.use}},
      };
}
