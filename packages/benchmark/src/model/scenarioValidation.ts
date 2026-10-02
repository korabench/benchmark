import * as v from "valibot";

//
// Runtime type.
//

const VScenarioValidationVerdict = v.picklist(["pass", "fail"]);

const VScenarioValidation = v.strictObject({
  verdict: VScenarioValidationVerdict,
  reasons: v.pipe(
    v.string(),
    v.minLength(20),
    v.maxLength(1000),
    v.metadata({
      description:
        "Brief explanation of the validation decision, citing specific issues if rejected. At most about 80 words.",
    })
  ),
});

//
// Exports.
//

export type ScenarioValidationVerdict = v.InferOutput<
  typeof VScenarioValidationVerdict
>;
export interface ScenarioValidation extends v.InferOutput<
  typeof VScenarioValidation
> {}

export const ScenarioValidationVerdict = {
  io: VScenarioValidationVerdict,
};

export const ScenarioValidation = {
  io: VScenarioValidation,
};
