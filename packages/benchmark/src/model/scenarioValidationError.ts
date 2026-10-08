import {CustomError} from "@korabench/core";
import {ScenarioSeed} from "./scenarioSeed.js";

export class ScenarioValidationError extends CustomError {
  constructor(
    public readonly seed: ScenarioSeed,
    public readonly lastReasons: string,
    public readonly attempts: number,
    /**
     * Every attempt answered no to `firstMessageShowsSignalType`: the seed
     * is stuck on its risk signal type, whatever else was also rejected.
     * See `relabelSignalType`.
     */
    public readonly stuckOnSignalType: boolean = false,
    /**
     * Every attempt answered no to `showsUse` or `firstMessageShowsUse`: the
     * seed is stuck on its use. See `relabelUse`.
     */
    public readonly stuckOnUse: boolean = false
  ) {
    super(
      `Scenario validation failed after ${attempts} attempts for seed ${seed.id}: ${lastReasons}`
    );
  }
}
