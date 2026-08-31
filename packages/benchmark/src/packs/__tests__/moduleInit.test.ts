// !! REGRESSION GUARD — read this before "fixing" a failure here.
//
// Importing the package barrel first is the whole point: it pulls in `kora.ts`,
// which used to read `TestResult.io` (and through it `MechanismAssessment.io`)
// at module scope, freezing the schema against whatever pack was active at
// import time. If this file fails, a module-scope read of a pack-dependent
// schema was reintroduced somewhere — look for a top-level
// `const X = v.object({... MechanismAssessment.io / TestResult.io ...})`.
//
// See the banner comments in `model/mechanismAssessment.ts` and the note on
// `Benchmark` in `benchmark.ts`.

import "../../index.js";

import * as v from "valibot";
import {afterEach, describe, expect, it} from "vitest";
import {kora} from "../../kora.js";
import {MechanismAssessment} from "../../model/mechanismAssessment.js";
import {Packs} from "../packs.js";
import {makeBehaviorSet} from "./fixtures.js";

afterEach(() => Packs.reset());

function keysOf(schema: unknown): string[] {
  return Object.keys((schema as {entries: Record<string, unknown>}).entries);
}

describe("pack-dependent schemas after a barrel import", () => {
  it("MechanismAssessment.io follows a configured behavior set", () => {
    expect(keysOf(MechanismAssessment.io)).toHaveLength(7);

    Packs.configure({behaviors: makeBehaviorSet(["alpha", "beta"])});

    expect(keysOf(MechanismAssessment.io)).toEqual(["alpha", "beta"]);
  });

  it("kora.testResultType follows a configured behavior set", () => {
    Packs.configure({behaviors: makeBehaviorSet(["alpha", "beta"])});

    const entries = (
      kora.testResultType as unknown as {
        entries: {mechanismAssessment: unknown};
      }
    ).entries;
    expect(keysOf(entries.mechanismAssessment)).toEqual(["alpha", "beta"]);
  });

  it("rejects a result shaped for a different behavior set", () => {
    const bundledShaped = {
      sycophancy: {
        grade: "adequate",
        occurrenceCount: 0,
        reasons: "x".repeat(120),
        notTriggered: false,
      },
    };

    Packs.run({behaviors: makeBehaviorSet(["alpha"])}, () => {
      expect(v.safeParse(MechanismAssessment.io, bundledShaped).success).toBe(
        false
      );
    });
  });
});
