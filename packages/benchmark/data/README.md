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
`riskSignalType` values a seed of that type is not given, each with the reason
and the evidence. A rule without a `riskId` applies to every risk that has a
situation type of that name. It trades uses and signal types between seeds of
a risk: it never moves a situation type, and never changes how many seeds
receive each use. A forbidden signal type is never kept: where no trade can
place it, the seed gets an allowed one, and the risk ends with fewer seeds of
that signal type than an even third. A use rule may name the use the
session is (`relabelTo`): `expand-scenarios` moves a seed to it when the
seed holds the forbidden use and every attempt rejected it on the use, which
a corpus allocated before the rule does. A pair belongs there
when the two definitions contradict each other; rules written from the
definitions alone say so in their reason, until a validation ledger confirms
them.

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

Each gold standard's `boundaries` is Section 4 ("Risk Boundaries") of the same
document, in its own wording: `borderlineCases` are the named cases listed
before the table, `examples` the table's rows (activates the risk, does not,
boundary principle). The safety judge's prompt quotes it (see below), and it is
what a person reviewing a scenario is shown next to the situation type. Left out: the notes on how to read
the table, the "Expected response" column of 6.3, the scenarios a reviewer
suggested after the table of 1.2b, and the "Disclosed ongoing use" case of 1.3,
which has a name but no text. The "Frontier 3.3 vs 3.4" paragraph that follows
the tables of 3.3 and 3.4 is kept as a borderline case.

## goldStandardRubrics/

One file per gold standard (`1.1.json` … `8.4.json`, 28 in all), loaded by
`src/model/goldStandardRubric.ts`: what the safety judge grades a conversation
against. Like the situation types it is outside the pack, but the files are
part of the prompts fingerprint (`src/prompts/promptsFingerprint.ts`), so any
edit changes the run stamp. Each file is transcribed from the post-review
gold standard in the "GS post expert review" Drive folder; `source` names the
document, its Drive id and the modification time it was read at (2026-10-12).
4.2 and 5.2 are the October versions (`KORA_GS_Risk4.2_FINAL`,
`KORA_GS_Risk5.2_FINAL_v2`); the others are `GS RISK <id> ... v1 FINAL SEPT 2026`.

- `harmStatement`: Section 1, "Harm statement (short)".
- `expectedMitigation`: Section 3, one item per paragraph.
- `criteria`: Section 5, the behavioural anchors C1–C9 with their weight as
  worded.
- `vetoes`: Section 6. `status: "proposed"` marks the vetoes the document says
  are "not applied by the judge until confirmed" (ruling §0.19); the judge's
  prompt leaves them out.
- `cases`: the calibration corpus of Part B (case id, title, age group, child
  profile, turns) with its gold label from Part C: the scorable `grade`, the
  `borderline` flag, the terminal decision-tree question and the criteria cited
  as written, the expert notes (named "Expert 1" / "Expert 2" where two
  experts annotated, "KORA team" for the bench v2 additions), and the
  reconciliation. Where a case has no reconciliation, its note comparing the
  gold label with the archived judge takes that place. The archived judge
  baselines themselves are left out: they are not gold. Emojis did not survive
  the Drive text export and read `[emoji]`.

Left out: Section 2 (risk profile), Section 7 (open decisions; its rulings are
already written into the anchors and vetoes), Part D, and the boundaries of
Section 4, which `situationTypes.json` holds. The grade scale, the decision
tree Q1–Q5 and the cross-risk rules (R-2, R-7, §0.16, §0.17, §0.20, §0.21)
are the same in every gold standard; the judge prompt carries them once.

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
