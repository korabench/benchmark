# Scenario creation

How the seed population for a run is drawn — which parameters are decided in
code, which are left to the model, and how the two generation modes differ.

This document zooms in on stage 1 of the pipeline. The
[README](README.md) documents the `generate-seeds` flags;
[EVALUATION_PROCESS.md](EVALUATION_PROCESS.md) walks the full
risk → seed → scenario → conversation → grade chain. Here we only cover how a
seed's parameters are chosen.

The governing principle: **anything that needs statistical control is allocated
in code and pinned into the prompt; the model only supplies narrative texture.**

## The unit of work

A **task** is one LLM call (`packages/benchmark/src/kora.ts:230`):

```ts
interface Task {
  riskCategory: RiskCategory;
  risk: Risk;
  ageRange: AgeRange;          // 7to9 | 10to12 | 13to17
  motivation: Motivation;      // {name, description} from the taxonomy
  seedsToGenerate: number;
  pinnedDemographics?: PinnedDemographics;  // {ageRange, gender, ses, raceEthnicity}
  pinnedFlavor?: ScenarioFlavor;            // risk-specific variant
}
```

Tasks are built per risk, and the two modes differ only in *how the task list is
constructed*. Everything after that — the prompt, the call, the stamping — is
shared.

## Distribution mode (what we use)

```bash
yarn kora generate-seeds gpt-4o \
  --distribution us-census-2020 \
  --total-seeds 30 \
  --random-seed 42
```

`--distribution` requires `--total-seeds` and is mutually exclusive with
`--seeds-per-task`. It produces **exactly `--total-seeds` seeds per risk**, one
per task, with demographic marginals matching a target population
(`kora.ts:241`).

For each risk, independently:

### 1. Personas — age band, gender, SES, race/ethnicity

`allocatePersonas(distribution, total, rng, ageRanges)`
(`packages/benchmark/src/allocation/allocatePersonas.ts`):

1. Each of the four dimensions is converted from proportions to **integer
   counts summing to exactly `total`** via the largest-remainder (Hamilton)
   method (`allocation/largestRemainder.ts`). Ties on the fractional remainder
   break by key-insertion order, so the result is deterministic.
2. Each count map is expanded into a flat array of length `total`
   (`["low","low",…,"middle",…]`).
3. Each array is **shuffled independently** with the run's RNG.
4. The four arrays are zipped index-wise into `PinnedDemographics`.

Consequences worth understanding:

- **Marginals are exact by construction** — not sampled, not approximate.
- **The joint distribution is the product of marginals in expectation.** The
  four dimensions are assigned independently, so real-world correlations (e.g.
  between SES and race/ethnicity) are deliberately *not* reproduced. Each
  dimension is balanced on its own.
- `--age-ranges` restricts the age dimension and **renormalizes** the remaining
  bands so they still sum to 1 (`renormalize()`); the other three dimensions are
  untouched.

The `us-census-2020` preset
(`packages/benchmark/src/model/populationDistributionPresets.ts`):

| Dimension | Proportions |
| --- | --- |
| Age band | `7to9` .27, `10to12` .27, `13to17` .46 |
| Gender | girl .50, boy .50 |
| SES | low .28, middle .46, high .26 |
| Race/ethnicity | white .51, hispanic .25, black .13, asian .05, other .06 |

Pass a JSON file path instead of a preset name for a custom distribution; every
dimension is validated to sum to 1.0 at load time.

### 2. Motivation — shuffled round-robin

Motivation is **not** drawn from a distribution. Per risk (`kora.ts:251`):

```ts
const motivationCycle = shuffleWith(motivations, rng);
// …
motivation: motivationCycle[i % motivationCycle.length]
```

The list is shuffled once per risk, then dealt cyclically across the `total`
personas. So motivation is *balanced*, not distributed: with 10 motivations and
`--total-seeds 25`, five motivations get 3 seeds and five get 2, and the shuffle
decides which. There is no way to weight motivations — only to filter the list
with `--motivations`, which is validated against the active taxonomy and throws
on unknown names.

Because both the persona arrays and the motivation cycle are shuffled from the
same RNG, motivation and demographics are effectively independent, but the
pairing is *strided* rather than sampled: when `total` is a multiple of the
motivation count, each motivation lands on a fixed stride through the persona
array.

### 3. Scenario flavor — largest-remainder, when the risk defines one

Some risks declare `scenarioFlavors` in `risks.json` — risk-specific variants
with their own proportions (e.g. privacy: `a_direct` .25, `b_gradual` .40,
`d_authority` .20, `e_fictional` .15). `allocateFlavors()` uses the same
largest-remainder + shuffle treatment as the demographics, and the chosen flavor
is pinned into both the seed and expansion prompts. A flavor may override the
risk's `conversationLength`. Risks without flavors skip this step.

### 4. Zip into tasks

Persona `i`, motivation `i % n`, and flavor `i` become one task with
`seedsToGenerate: 1`. That is the whole allocation — `personas.length` tasks per
risk, one seed each.

### Reproducibility

Every shuffle draws from `makeRng(--random-seed)` (mulberry32,
`allocation/rng.ts`). With a seed, the entire allocation is reproducible; without
one, it falls back to `Math.random`. The allocation is deterministic, the LLM
output is not.

### Worked example — the shipped corpus

`data/scenarioSeeds.jsonl`: 26 risks × 30 seeds = 781 (one risk carries an extra
31st seed). Per risk, at `--total-seeds 30` with `us-census-2020`:

| Dimension | Counts |
| --- | --- |
| Age band | 8 / 8 / 14 (`7to9` / `10to12` / `13to17`) |
| Gender | 15 girl / 15 boy |
| SES | 8 low / 14 middle / 8 high |
| Race/ethnicity | 15 white / 8 hispanic / 4 black / 1 asian / 2 other |
| Motivation | 3 each, all 10 |

`generate-seeds` prints this allocation before starting, so you can check it
without generating anything.

Note the small cells: n=1 for `asian` per risk, and n=3 per (risk × motivation)
pair. That is enough for coverage auditing — every cell is non-empty — but far
too thin to read an effect within a single risk. Pooled across the 26 risks the
same slices are n≈26 and n≈78, which is where comparisons start to have power.

## Grid mode (the default)

Without `--distribution`, tasks come from the **cross product**
`ageRanges × motivations` per risk (`kora.ts:272`): 3 age bands × 10 motivations
= 30 combos.

- **Default, or `--seeds-per-task N`**: every combo becomes a task producing `N`
  seeds (default 8) → 240 seeds per risk. Exhaustive coverage of the grid.
- **`--total-seeds N`**: `R.sample(combos, N)` takes a uniform random subset of
  the combos, 1 seed each. It throws if `N` exceeds the 30 available combos,
  pointing at `--seeds-per-task` for larger runs.

Grid mode pins nothing beyond age band and motivation. Gender, race/ethnicity,
and age within the band are left to the model, steered only by a diversity
block in the prompt: all five race categories must appear at least once across
the batch, vary ages / genders / settings / expression. `childSES` is never set —
it exists only in distribution mode.

## The two modes side by side

| | Distribution mode | Grid mode |
| --- | --- | --- |
| Trigger | `--distribution` + `--total-seeds` | default |
| Seeds per risk | exactly `--total-seeds` | 30 × `--seeds-per-task`, or `--total-seeds` |
| Seeds per task | 1 | `--seeds-per-task` (default 8) |
| Age band | allocated to marginals | every band, crossed with motivation |
| Age within band | model picks, clamped to the band | model picks freely |
| Gender / race | allocated, pinned verbatim | model picks (diversity prompt) |
| SES | allocated, pinned | not set |
| Motivation | shuffled round-robin | crossed exhaustively |
| Scenario flavor | allocated to proportions | not pinned |
| Reproducible | yes, with `--random-seed` | combo sampling only |

## What the model chooses either way

`riskToScenarioSeedsPrompt` frames the motivation as the *"PRIMARY MOTIVATIONAL
PROFILE (drives why the child acts)"* and, in distribution mode, adds a
pinned-demographics block: reproduce these values verbatim, but still vary
maturity, `riskSignalType`, `socialContext`, and narrative details.

So the model always supplies:

- `childCognitiveMaturity`, `childEmotionalMaturity` (low / medium / high)
- `riskSignalType` — direct / subtle / ambiguous
- `socialContext` — alone / peer_pressure / authority_influence / online_social
- `shortTitle`, `coreBehavior`, `context`, `notes`
- `childAge` within the pinned band

None of these are balanced by the harness; they vary only as far as the prompt
pushes the model to vary them. If a run needs control over one of them, it has
to move into the allocator.

## Stamping

After the call, the code attaches everything the model must not choose
(`kora.ts:338`): `id` (uuid), `riskCategoryId`, `riskId`, `ageRange`, the full
`motivation` object, `taxonomyId` / `taxonomyVersion`, the run `stamp`, and
`scenarioFlavorId`. In distribution mode it then **overwrites** `childGender`,
`childRaceEthnicity` and `childSES` with the pinned values and clamps `childAge`
into the pinned band — the prompt asks for compliance, the code enforces it.

Seeds under `data/` predate packs and run stamps, so `taxonomyId` and `stamp`
are absent there; both fields are optional for that reason.

Tasks run 10-wide and seeds stream to JSONL as they arrive. Expansion into full
scenarios is stage 2 — see [EVALUATION_PROCESS.md](EVALUATION_PROCESS.md).
