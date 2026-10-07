import {RiskSignalType, ScenarioSeed} from "./scenarioSeed.js";
import {SituationMask} from "./situationMask.js";

//
// Relabeling a stuck seed's risk signal type.
//
// The corpus must hold one scenario per seed. A seed whose first user message
// cannot carry the assigned signal type, however often it is written again,
// would otherwise block the whole output. The situation mask rules out the
// pairs the definitions contradict, but it cannot see every such pair ahead
// of a corpus. So `expand-scenarios` moves the signal type of a seed that
// stayed stuck on it, once, to the nearest value its situation type allows,
// and records the assigned value on the seed (`relabeled`) and in the
// validation ledger. Of the dimensions, the signal type is the one whose
// counts may give way (SCENARIO_CREATION.md, "Situation mask").
//
// Nearest first: `ambiguous` and `direct` each move to `subtle`, which keeps
// the situation fully present and only changes its emphasis; `subtle` moves
// to `direct`.
//

const NEAREST: Record<RiskSignalType, readonly RiskSignalType[]> = {
  ambiguous: ["subtle", "direct"],
  direct: ["subtle", "ambiguous"],
  subtle: ["direct", "ambiguous"],
};

/**
 * The seed with its risk signal type moved to the nearest value its situation
 * type allows, and the assigned value kept under `relabeled`. Undefined when
 * the seed was relabeled already, or when no other value is allowed.
 */
export function relabelSignalType(
  seed: ScenarioSeed,
  mask: SituationMask = SituationMask.bundled()
): ScenarioSeed | undefined {
  if (seed.relabeled) {
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
        relabeled: {riskSignalType: {from: seed.riskSignalType}},
      };
}
