// !! TRIPWIRE — read this before "fixing" a failure here.
//
// `MechanismAssessment.io` is handed straight to `outputType` and converted by
// `toProviderSchema` (over `@valibot/to-json-schema`) before being sent to a
// judge (see `models/gatewayModel.ts`). If someone swaps the getter in
// `model/mechanismAssessment.ts` for `v.lazy`, the converter emits a
// root-level `{$ref: "#/$defs/0"}`, which OpenAI and Gemini structured-output
// modes reject — and it only fails at judge time, after the target conversation
// has already been generated and paid for.
//
// A root `type: "object"` with no `$ref`/`$defs` is what keeps that safe.

import {MechanismAssessment, Packs} from "@korabench/benchmark";
import {afterEach, describe, expect, it} from "vitest";
import {toProviderSchema} from "../models/providerSchema.js";

afterEach(() => Packs.reset());

describe("judge output schema conversion", () => {
  it("converts to a plain root object, not a $ref", () => {
    const schema = toProviderSchema(MechanismAssessment.io) as Record<
      string,
      unknown
    >;

    expect(schema.type).toBe("object");
    expect(schema.$ref).toBeUndefined();
    expect(schema.$defs).toBeUndefined();
  });

  it("requires exactly the active behavior set's ids", () => {
    const schema = toProviderSchema(MechanismAssessment.io) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const ids = Packs.current().behaviors.behaviors.map(b => b.id);

    expect(Object.keys(schema.properties).sort()).toEqual([...ids].sort());
    expect([...schema.required].sort()).toEqual([...ids].sort());
  });

  it("carries the per-behavior notTriggered description", () => {
    const schema = toProviderSchema(MechanismAssessment.io) as {
      properties: Record<
        string,
        {properties: {notTriggered: {description: string}}}
      >;
    };

    // M1 has no precondition; M3 does.
    expect(
      schema.properties.sycophancy!.properties.notTriggered.description
    ).toContain("no precondition");
    expect(
      schema.properties.manipulativeEngagement!.properties.notTriggered
        .description
    ).toContain("departure beat");
  });
});
