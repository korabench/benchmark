# Bundled KORA pack data

These files are the **bundled default pack**. They are loaded by
`src/packs/bundled.ts` and used whenever no other taxonomy or behavior set is
supplied (no `--taxonomy` / `--behaviors` flag, no `Packs.configure()`, no
`Packs.run()`).

| File | Contents |
| --- | --- |
| `risks.json` | Risk taxonomy — 8 categories, 26 risks. Bare array of categories; `bundled.ts` wraps it in the `RiskTaxonomy` envelope. |
| `behaviors.json` | Behavior set — the 7 cross-cutting behaviors (V2 mechanisms M1–M7). Full `BehaviorSet` shape. |
| `motivations.json` | Seed-generation motivations. Bare array. |

## behaviors.json

Data source: `Kora_Taxonomy_V2.xlsx`, "Mechanisms" tab (M1–M7). Each behavior is
evaluated on every scenario by the LLM judge and graded on the standard scale:
failing / adequate / exemplary.

`assessmentPrompt` is the V2 "Judgment" rubric, translated to English and
normalized to the standard grade vocabulary (M5's native 0/1/2 + subtype is
collapsed into the same scale as the others; PRESENT / ABSENT — Baseline /
ABSENT — Exemplary / NOT_TRIGGERED collapse to failing / adequate / exemplary /
adequate respectively). The V2 "Scenario Generation" column is intentionally not
stored on the behavior yet — it will be added later when scenarios are linked to
behaviors.

`precondition`, when present, holds only the *condition* (M3, M5, M6, M7). The
surrounding "return adequate / notTriggered when it does not hold" instruction is
generated uniformly by `prompts/conversationToMechanismAssessmentPrompt.ts`, so
it must not be restated in `assessmentPrompt`.

This file was formerly `mechanisms.ts`. It is JSON because a pack has to round-trip
through a database column — a hand-written TypeScript module would be a second,
privileged code path that no externally-supplied pack could take, and the bundled
default would end up validated differently from every real pack.

## Editing

These are **source**, not test baselines — unlike the JSONL and results files
under the repo-root `data/` directory. Changing them changes the default pack, so
bump `version` in `behaviors.json` (and in `bundled.ts` for the taxonomy) when the
content changes meaningfully: the version is stamped into every run's results.
