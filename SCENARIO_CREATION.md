# Scenario creation

How the seed population for a run is drawn: which dimensions a seed carries, how
each one is allocated, and what is left for the model to write.

This document zooms in on stage 1 of the pipeline. The
[README](README.md) documents the `generate-seeds` flags;
[EVALUATION_PROCESS.md](EVALUATION_PROCESS.md) walks the full
risk → seed → scenario → conversation → grade chain. Here we only cover how a
seed's parameters are chosen.

The governing principle: **every dimension of a seed is allocated in code and
handed to the model as a fixed input. The model chooses none of them; it only
writes the narrative.**

Left to the model, dimensions collapse. In the corpus generated before this
rule, `riskSignalType` came out 66% subtle / 29% ambiguous / 5% direct (12 of 26
risks had no `direct` seed at all), exact ages landed almost only on 8, 11 and
15, and `socialContext` simply mirrored the motivation.

## The dimensions of a seed

| Dimension | Values | Allocation per risk |
| --- | --- | --- |
| `riskCategoryId`, `riskId` | taxonomy | `--total-seeds` seeds for every risk |
| `ageRange` | `7to9` / `10to12` / `13to17` | population distribution |
| `childAge` | 7–17 | even over the years of the assigned band |
| `childGender` | girl / boy | population distribution |
| `childSES` | low / middle / high | population distribution |
| `childRaceEthnicity` | white / hispanic / black / asian / other | population distribution |
| `motivation` | the taxonomy's motivations (10) | even (shuffled round-robin) |
| `socialContext` | alone / peer_pressure / authority_influence / online_social | even |
| `riskSignalType` | direct / subtle / ambiguous | even (1/3 each) |
| `use` | homework / entertainment / companionship / health_advice / creative / learning / research | even (1/7 each) |
| `refusalBehavior` | insists / drops / works_around | even (1/3 each) |
| `scenarioFlavorId` | the risk's flavors, if it defines any | the flavors' own proportions |
| `memory` | none / established | from the risk (`provideUserContext`) |

What each of the less obvious ones means:

- **`use`** — why the child opened the assistant in this session. It is the
  activity the session is about, not the topic of the risky request: the risk
  emerges within or alongside that activity.
- **`riskSignalType`** — how clearly the risk shows in what the child says.
- **`socialContext`** — who or what influences the child.
- **`refusalBehavior`** — how the simulated child reacts when the assistant
  declines, deflects or redirects. It never shapes the seed text; it drives the
  follow-up turns of the conversation.
- **`memory`** — whether the assistant holds memory of the child from earlier
  conversations. Today every seed of a risk gets the same value, taken from the
  risk's `provideUserContext`. It lives on the seed so it can later be varied
  per seed without touching expansion, which reads it from the seed.

The model writes only `shortTitle`, `coreBehavior`, `context` and `notes`.

## The unit of work

A **task** is one LLM call producing one seed
(`packages/benchmark/src/kora.ts:210`):

```ts
interface Task {
  riskCategory: RiskCategory;
  risk: Risk;
  assignment: SeedAssignment; // every dimension above, already decided
}
```

```bash
yarn kora generate-seeds gpt-4o --total-seeds 30 --random-seed 42
```

produces **exactly `--total-seeds` seeds per risk** (default 30), against the
`--distribution` population (default `us-census-2020`).

## Allocation

`allocateSeedAssignments()`
(`packages/benchmark/src/allocation/allocateSeedAssignments.ts`) builds the
`total` assignments of one risk. Each dimension is allocated **on its own** to
exact counts, **shuffled independently**, then zipped index-wise.

Consequences worth understanding:

- **Marginals are exact by construction** — not sampled, not approximate.
- **The joint distribution is the product of marginals in expectation.** No
  dimension depends on another, so real-world correlations (e.g. between SES and
  race/ethnicity) are deliberately *not* reproduced, and some combinations will
  be unusual. Nothing filters or repairs unlikely combinations today.
- Balance holds **per risk**, and therefore across the corpus.

### 1. Personas — age band, gender, SES, race/ethnicity

`allocatePersonas(distribution, total, rng, ageRanges)`
(`allocation/allocatePersonas.ts`):

1. Each of the four dimensions is converted from proportions to **integer
   counts summing to exactly `total`** via the largest-remainder (Hamilton)
   method (`allocation/largestRemainder.ts`). Ties on the fractional remainder
   break by key-insertion order, so the result is deterministic.
2. Each count map is expanded into a flat array of length `total`
   (`["low","low",…,"middle",…]`).
3. Each array is shuffled independently with the run's RNG.

`--age-ranges` restricts the age dimension and **renormalizes** the remaining
bands so they still sum to 1; the other three dimensions are untouched.

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

### 2. Exact age — even within the band

`allocateAges()` (`allocation/allocateAges.ts`) takes the seeds of each band and
spreads them evenly over the years the band covers (`AgeRange.years`): with 14
seeds in `13to17`, each of the five ages gets 2 or 3.

### 3. Motivation — shuffled round-robin

The motivation list is shuffled once per risk, then dealt cyclically across the
seeds. With 10 motivations and `--total-seeds 25`, five motivations get 3 seeds
and five get 2, and the shuffle decides which. There is no way to weight
motivations — only to filter the list with `--motivations`, which is validated
against the active taxonomy and throws on unknown names.

### 4. Social context, risk signal type, use, refusal behavior — even

`allocateUniform(values, total, rng)` (`allocation/allocateUniform.ts`): every
value gets `floor(total / n)` seeds or one more, then the result is shuffled.

When `total` is not a multiple of the number of values, **the values receiving
the extra seed are drawn at random**. Always favouring the first values would
bias the corpus once repeated per risk: 10 seeds over 3 signal types would give
4/3/3 for every risk, i.e. 40/30/30 overall instead of thirds.

### 5. Scenario flavor — largest-remainder, when the risk defines one

Some risks declare `scenarioFlavors` in `risks.json` — risk-specific variants
with their own proportions (e.g. privacy: `a_direct` .25, `b_gradual` .40,
`d_authority` .20, `e_fictional` .15). `allocateFlavors()` uses the same
largest-remainder + shuffle treatment as the demographics, and the chosen flavor
is pinned into both the seed and expansion prompts. A flavor may override the
risk's `conversationLength`. Risks without flavors skip this step.

### 6. Memory — from the risk

`established` when the risk sets `provideUserContext`, `none` otherwise.

### Reproducibility

Every shuffle draws from `makeRng(--random-seed)` (mulberry32,
`allocation/rng.ts`). With a seed, the entire allocation is reproducible; without
one, it falls back to `Math.random`. The allocation is deterministic, the LLM
output is not.

The persona, motivation and flavor draws come first and in their historical
order, so a given `--random-seed` still yields the demographics it yielded
before the other dimensions were allocated.

### Worked example — `--total-seeds 30`, `us-census-2020`

| Dimension | Counts per risk |
| --- | --- |
| Age band | 8 / 8 / 14 (`7to9` / `10to12` / `13to17`) |
| Exact age | 2–3 per year in each band |
| Gender | 15 girl / 15 boy |
| SES | 8 low / 14 middle / 8 high |
| Race/ethnicity | 15 white / 8 hispanic / 4 black / 1 asian / 2 other |
| Motivation | 3 each, all 10 |
| Social context | 7–8 each |
| Risk signal type | 10 each |
| Use | 4–5 each |
| Refusal behavior | 10 each |

`generate-seeds` prints this allocation before starting, so you can check it
without generating anything.

Note the small cells: n=1 for `asian` per risk, and n=3 per (risk × motivation)
pair. That is enough for coverage auditing — every cell is non-empty — but far
too thin to read an effect within a single risk. Pooled across the 26 risks the
same slices are n≈26 and n≈78, which is where comparisons start to have power.

## The call

`riskToScenarioSeedsPrompt` gives the model the risk, the flavor if any, and the
assigned child, motivation, use, social context and risk signal type, each with
its description. It asks for narrative fields **consistent with every assigned
value**, and forbids contradicting, dropping or reinterpreting one.

`refusalBehavior` and `memory` are deliberately absent from this prompt: they do
not shape the seed.

## Stamping

After the call, the stored seed is assembled from the **assignment**, not from
the model's answer (`kora.ts:253`). Only `shortTitle`, `coreBehavior`, `context`
and `notes` come from the model, whose output schema (`ModelScenarioSeed`)
contains nothing else. The code also attaches `id` (uuid), `riskCategoryId`,
`riskId`, `taxonomyId` / `taxonomyVersion` and the run `stamp`.

Tasks run 10-wide and seeds stream to JSONL as they arrive. Expansion into full
scenarios is stage 2 — see [EVALUATION_PROCESS.md](EVALUATION_PROCESS.md).

## Where each dimension takes effect

| Dimension | Seed prompt | Expansion | First message | Later turns |
| --- | --- | --- | --- | --- |
| Child, motivation, social context | yes | yes | child only | child's age |
| `use` | yes | yes | yes | via the narrative |
| `riskSignalType` | yes | yes | sets how the opening carries the risk | — |
| `scenarioFlavorId` | yes | yes | `b_gradual` rules | conversation length |
| `memory` | — | asks for a `modelMemory` | — | in the target's system prompt |
| `refusalBehavior` | — | — | — | how the child reacts to a refusal |

Judges see none of the dimensions beyond the child's age: they grade the
assistant, and are given the scenario's background and narrative.

## Legacy corpora

`data/scenarioSeeds.jsonl` and `data/scenarios.jsonl` were generated before this
design (see "Reproducing the shipped corpus" in
[EVALUATION_PROCESS.md](EVALUATION_PROCESS.md)). Their seeds:

- carry `childCognitiveMaturity` / `childEmotionalMaturity`, and their scenarios
  a `childMaturity` paragraph. Maturity is no longer a dimension: nothing writes
  these fields any more, but they remain valid optional keys, and the simulator
  and judge prompts still render them **when present**, so a legacy scenario
  produces the same prompts it always did;
- have no `use`, `refusalBehavior` or `memory`. The simulator then keeps its
  open-ended wording ("may persist, soften, or rephrase"), and memory falls back
  to the risk's `provideUserContext`;
- got `riskSignalType`, `socialContext` and the exact age from the model, so
  those are unbalanced there.

They also predate packs and run stamps, so `taxonomyId` and `stamp` are absent;
both fields are optional for that reason.
