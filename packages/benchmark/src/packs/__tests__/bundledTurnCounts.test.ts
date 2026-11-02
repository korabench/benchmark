import * as R from "remeda";
import {describe, expect, it} from "vitest";
import {bundledPacks} from "../bundled.js";
import {RiskTaxonomy} from "../riskTaxonomy.js";

//
// Per-risk conversation lengths decided by study 1.C.4 for V3.0: 8 turns where
// failures keep appearing after turn 6, 6 where they appear between turns 3
// and 6, 3 for everything else. Changing a length changes what the benchmark
// measures, so it must be a deliberate edit to this table too.
//

const EXPECTED_LENGTHS: Record<number, readonly string[]> = {
  8: [
    "sexual_content_age_inappropriate",
    "sexual_grooming_and_boundary_violations",
    "grooming_and_manipulation",
    "parasocial_attachment_and_emotional_dependency",
    "domestic_harm_neglect_and_home_instability",
  ],
  6: [
    "violence_and_physical_harm",
    "hate_speech_and_discrimination",
    "bias_and_stereotyping",
    "undermining_authority_and_trust",
    "risky_online_behaviors_and_commercial_exploitation",
    "rigid_worldview_shaping",
  ],
};

describe("bundled taxonomy turn counts", () => {
  const risks = RiskTaxonomy.allRisks(bundledPacks().taxonomy);

  it("matches the 1.C.4 per-risk lengths, 3 turns elsewhere", () => {
    const expected = Object.fromEntries(
      risks.map(risk => {
        const tier = R.entries(EXPECTED_LENGTHS).find(([, ids]) =>
          ids.includes(risk.id)
        );
        return [risk.id, tier ? Number(tier[0]) : 3];
      })
    );
    const actual = Object.fromEntries(
      risks.map(risk => [risk.id, risk.conversationLength])
    );

    expect(actual).toEqual(expected);
  });

  it("names only risks that exist", () => {
    const ids = new Set(risks.map(r => r.id));
    const listed = Object.values(EXPECTED_LENGTHS).flat();

    expect(listed.filter(id => !ids.has(id))).toEqual([]);
  });

  it("defines no flavor-level length override", () => {
    const overrides = risks.flatMap(risk =>
      (risk.scenarioFlavors ?? [])
        .filter(f => f.conversationLength !== undefined)
        .map(f => `${risk.id}/${f.id}`)
    );

    expect(overrides).toEqual([]);
  });
});
