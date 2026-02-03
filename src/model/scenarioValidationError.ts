import {CustomError} from "@korabench/core";
import {ScenarioSeed} from "./scenarioSeed.js";

export class ScenarioValidationError extends CustomError {
  constructor(
    public readonly seed: ScenarioSeed,
    public readonly lastReasons: string,
    public readonly attempts: number
  ) {
    super(
      `Scenario validation failed after ${attempts} attempts for seed ${seed.id}: ${lastReasons}`
    );
  }
}
