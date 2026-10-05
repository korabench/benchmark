# Bundled KORA pack data

These files are the **bundled default pack**. They are loaded by
`src/packs/bundled.ts` and used whenever no other taxonomy or behavior set is
supplied (no `--taxonomy` / `--behaviors` flag, no `Packs.configure()`, no
`Packs.run()`).

| File               | Contents                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `risks.json`       | Risk taxonomy — 8 categories, 26 risks. Bare array of categories; `bundled.ts` wraps it in the `RiskTaxonomy` envelope. |
| `behaviors.json`   | Behavior set — the 7 cross-cutting behaviors (V2 mechanisms M1–M7). Full `BehaviorSet` shape.                           |
| `motivations.json` | Seed-generation motivations. Bare array.                                                                                |

Each risk's `description` in `risks.json` is the "Harm statement (short)" of
Section 1 of its gold standard (`GS RISK <id> ... v1 FINAL SEPT 2026`), word for
word. Self-harm, an umbrella over three gold standards, carries the three
statements, each prefixed with its gold standard's name and number. This is
taxonomy version 3.

`scenarioGuidance`, on six risks (3.1, 3.3, 3.4, 5.2, 6.1, 7.3), tells the
expansion step where the risk does and does not activate. It is written from
Section 1 ("Scenarios in scope") and Section 4 ("Risk Boundaries") of the same
gold standard, in our words rather than quoted. No risk defines
`scenarioFlavors` any more: situation types took over that role.

`risks.legacy.json` is `risks.json` as it was in version 2, before the gold
standards: the longer scope descriptions the published results were produced
with. It is kept so that a run can still be made against them and compared with
that baseline: `--taxonomy kora-legacy` loads it as `kora@2`, with the pack
stamp those results carry. Do not edit it.

`motivationUseMask.json` also lives here but is **not part of the pack**: it is
seed-generation input, loaded by `src/model/motivationUseMask.ts`, and editing
it does not change the pack stamp on results. It says whether each bundled
motivation can go with each seed `use`: `true` when allowed, `false` when the
pairing is never made (when avoidable); anything unlisted is allowed. It decides
which motivation is paired with which use, never how many seeds each receives.
Keys are motivation names from `motivations.json` and `use` values from
`src/model/scenarioSeed.ts`. Data source: `motivation_use_mask_v3.0.csv` of the
V3.0 pipeline inputs.

`situationMask.json` is seed-generation input as well, loaded by
`src/model/situationMask.ts`. It lists, per situation type, the `use` and
`riskSignalType` values a seed of that type is never given (when avoidable),
each with the reason and the evidence. A rule without a `riskId` applies to
every risk that has a situation type of that name. It trades uses and signal
types between seeds of a risk: it never moves a situation type, and never
changes how many seeds receive each use or each signal type. Keep it small: a
pair belongs there when the two definitions contradict each other and
rejections show it.

`situationTypes.json` is seed-generation input too, loaded by
`src/model/situationTypes.ts`, and likewise outside the pack. For each bundled
risk it lists the risk's gold standards (one, or three for the self-harm
umbrella: 1.2a, 1.2b, 1.2c) and, for each, its situation types in the order of
Section 1 of the gold standard. Types flagged `drift` receive no seeds. A type
whose definition is about a child of a given age carries `ageRanges`, and only
seeds of those age bands receive it (8.1: "Direct request from young child" is
7–9, "Adolescent infantilisation" is 13–17). Data
source: the "Situation types" tab of
`KORA_Bench_V3.0_GS_Situation_Types_and_Allocation`. The order of the types
matters: it decides which types take the leftover seeds.

Each type's `description` is its definition in the "Scenarios in scope" list of
Section 1 of the gold standard (`GS RISK <id> ... v1 FINAL SEPT 2026`), quoted
in the seed, expansion and validation prompts. It is the gold standard's own
wording. Ten are cut down to the sentences that describe the situation, where
the original also holds response guidance, citations or reviewer comments: 1.2a
"Reframed request" and "Indirect / coded disclosure", 1.2b "Peer-exposure
concern" and the five types after it, 7.3 "Child volunteers data" and 8.4
"Context-signalled displacement". Editing a description changes what the prompts
say, so bump the prompts fingerprint version with it.

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

`precondition`, when present, holds only the _condition_ (M3, M5, M6, M7). The
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
