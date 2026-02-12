# KORA Benchmark

The first public benchmark for AI child safety. Learn more at [korabench.ai](https://korabench.ai).

## Overview

KORA measures the safety of AI models interacting with children across 8 risk categories, 25 individual risks, 3 age groups (7–9, 10–12, 13–17), and 10 child motivations. It produces per-risk grades — failing, adequate, or exemplary — for both safety and three behavioral criteria.

The benchmark uses a 3-stage pipeline: **seed generation** creates short scenario outlines from the risk taxonomy, **scenario expansion** turns each seed into a detailed test scenario with validation, and **test runs** execute multi-turn conversations and judge the results.

Each test is a 3-turn conversation between a simulated child user and the target model. A judge model then evaluates the conversation on safety and on three behavioral criteria: anthropomorphism, epistemic humility, and human redirection. Every scenario is tested twice — once with no age context in the system prompt (`default`) and once with an age-aware system prompt (`child`).

## Prerequisites

- **Node.js 25+**
- **Yarn**
- **AI Gateway API key** — set the `AI_GATEWAY_API_KEY` environment variable for the AI SDK gateway.

## Getting started

Install dependencies and build:

```bash
yarn && yarn tsbuild
```

Run the benchmark with pre-built scenarios:

```bash
yarn kora run <judge-model> <user-model> <target-model>
```

For example, to evaluate `openai/gpt-4o` using `anthropic/claude-sonnet-4` as both judge and user model:

```bash
yarn kora run anthropic/claude-sonnet-4 anthropic/claude-sonnet-4 openai/gpt-4o
```

## Pipeline stages

### `generate-seeds`

Generates a set of scenario seeds from the risk taxonomy.

```bash
yarn kora generate-seeds <model> [output-path]
```

| Argument | Description |
|---|---|
| `<model>` | Model to use for seed generation |
| `[output-path]` | Output JSONL file (default: `data/seeds.jsonl`) |

### `expand-scenarios`

Transforms seeds into fully fleshed-out scenarios with validation.

```bash
yarn kora expand-scenarios <model> <user-model> [seeds-path] [output-path]
```

| Argument | Description |
|---|---|
| `<model>` | Model to use for scenario expansion |
| `<user-model>` | Model to use for generating the first user message |
| `[seeds-path]` | Input seeds JSONL file (default: `data/seeds.jsonl`) |
| `[output-path]` | Output scenarios JSONL file (default: `data/scenarios.jsonl`) |

### `run`

Runs the benchmark against the target model.

```bash
yarn kora run <judge-model> <user-model> <target-model> [scenarios-path] [output-path]
```

| Argument | Description |
|---|---|
| `<judge-model>` | Model to use as judge |
| `<user-model>` | Model to use for simulating the child user |
| `<target-model>` | Model to benchmark |
| `[scenarios-path]` | Input scenarios JSONL file (default: `data/scenarios.jsonl`) |
| `[output-path]` | Output results JSON file (default: `data/results.json`) |

All commands write to `data/` by default. Commands are restartable — progress is tracked via temp files so interrupted runs resume where they left off.

## Model configuration

### Model registry (`models.json`)

Models are configured in a `models.json` file at the project root. The CLI searches for this file starting from the current directory and walking up. Each entry maps a **model slug** (used on the command line) to its configuration:

```json
{
  "gpt-5.2:high": {
    "model": "openai/gpt-5.2",
    "maxTokens": 26000,
    "providerOptions": {
      "openai": {
        "reasoningEffort": "high"
      }
    }
  },
  "deepseek-v3": {
    "model": "deepseek/deepseek-chat",
    "maxTokens": 26000,
    "temperature": 0.5
  }
}
```

| Field | Required | Description |
|---|---|---|
| `model` | Yes | Provider/model identifier for the [AI SDK gateway](https://ai-sdk.dev/docs/ai-sdk-core/provider-management#ai-sdk-providers-gateway) (e.g. `openai/gpt-4o`) |
| `maxTokens` | No | Maximum output tokens (default: 4000) |
| `temperature` | No | Sampling temperature |
| `providerOptions` | No | Provider-specific options passed through to the AI SDK |

Authentication is handled via the `AI_GATEWAY_API_KEY` environment variable.

### Custom models

Model slugs that start with `custom-` bypass the AI SDK gateway and are routed to `packages/cli/src/customModel.ts`. This lets you integrate any model backend — a local server, a custom API, or a model behind a proprietary SDK.

To add a custom model, edit `customModel.ts` and replace the `throw` with your implementation:

```ts
export async function getCustomTextResponse(
  modelSlug: string,
  _request: ModelRequest,
  retryOptions: RetryOptions
): Promise<string> {
  return withRetry(async () => {
    // Replace this with your custom model call.
    // request.messages contains the conversation (system, user, assistant messages).
    // request.maxTokens and request.temperature are optional hints.
    // Return the model's text response.
    throw new Error(
      `Custom model "${modelSlug}" is not implemented. ` +
        `Provide an implementation in customModel.ts.`
    );
  }, retryOptions);
}
```

The function receives:
- `modelSlug` — the full slug (e.g. `custom-my-model`), so you can route to different backends.
- `request` — a `ModelRequest` with `messages`, optional `maxTokens`, and optional `temperature`.
- `retryOptions` — pre-configured retry options with exponential backoff. The `withRetry` wrapper handles transient errors automatically.

Then use the slug on the command line like any other model:

```bash
yarn kora run anthropic/claude-sonnet-4 anthropic/claude-sonnet-4 custom-my-model
```

Custom model routing is only supported for text responses (the user and target model roles). Judge models and seed/scenario generation require structured output and must use registry models.

## Evaluating a different model

To evaluate a new model, only change the `<target-model>` argument in the `run` command. Keep the judge and user models the same across evaluations for comparability.

## Risk taxonomy

The benchmark covers 8 risk categories with 25 individual risks:

| Category ID | Name |
|---|---|
| `physical_and_legal_safety` | Physical & Legal Safety |
| `sexual_content_exploitation_and_predation` | Sexual Content, Exploitation & Predation |
| `psychological_and_emotional_safety` | Psychological & Emotional Safety |
| `educational_and_epistemic_integrity` | Educational & Epistemic Integrity |
| `bias_hate_and_societal_harm` | Bias, Hate & Societal Harm |
| `social_family_and_behavioral_influence` | Social, Family & Behavioral Influence |
| `online_safety` | Online Safety |
| `developmental_risk` | Developmental Risk |

See the full taxonomy: [KORA Risk Taxonomy](https://korabench.notion.site/KORA-Risk-Taxonomy-2fb5eb9ec0c98050b330d4f37c57d5b0).

In addition to safety, each conversation is assessed on three behavioral criteria:

- **Anthropomorphism** — anthropomorphic cues that make the AI appear more human-like.
- **Epistemic humility** — confident hallucinations vs. appropriate admission of limits.
- **Human redirection** — redirection to trusted humans in high-stakes moments.

## Interpreting results

The `run` command produces a result object with this structure:

```json
{
  "scores": [
    {
      "riskCategoryId": "...",
      "riskId": "...",
      "ageRange": "7to9",
      "prompt": "default",
      "sums": {
        "al": 42,
        "as": [3, 25, 14],
        "an": [1, 30, 11, 35],
        "eh": [0, 28, 14, 40],
        "hr": [2, 26, 14, 38]
      }
    }
  ]
}
```

| Field | Description |
|---|---|
| `sums.al` | Total test count |
| `sums.as` | Safety grades: `[failing, adequate, exemplary]` |
| `sums.an` | Anthropomorphism: `[failing, adequate, exemplary, occurrenceCount]` |
| `sums.eh` | Epistemic humility: `[failing, adequate, exemplary, occurrenceCount]` |
| `sums.hr` | Human redirection: `[failing, adequate, exemplary, occurrenceCount]` |

Scores are grouped by risk category, risk, age range, and prompt variant. Two prompt variants are used:

- **`default`** — no age context in the system prompt.
- **`child`** — the system prompt includes the child's age range.

## Cost and duration

Each pipeline stage makes the following API calls:

- **Seed generation**: 1 call per (risk x age range x motivation) combination = 25 x 3 x 10 = **750 calls**, producing 8 seeds each (6,000 seeds total).
- **Scenario expansion**: 3–5 calls per seed (1 generate + 1 validate + 1 first user message on pass; up to 2 generate + 2 validate + 1 first user message on retry).
- **Test run**: 7 calls per test (2 user responses + 3 target model responses + 2 judge responses), with 2 tests per scenario (`default` + `child`).

All commands run with a concurrency of 10 parallel tasks.

## Project structure

```
models.json                          Model registry configuration
data/                                Risk taxonomy, motivations, scenario data
packages/
  benchmark/src/                     Core benchmark logic
    prompts/                         Prompt templates for each pipeline stage
    __tests__/                       Test suites
    benchmark.ts                     Core benchmark interface
    kora.ts                          KORA benchmark implementation
  cli/src/                           CLI package
    commands/                        CLI command implementations
    model.ts                         Model resolution and AI SDK integration
    modelConfig.ts                   Model registry loader
    customModel.ts                   Custom model hook (edit to add your own)
    retry.ts                         Retry with exponential backoff
    cli.ts                           CLI entry point
```

## Development

```bash
yarn tsbuild      # Type check
yarn test          # Run tests
yarn lint          # Lint
yarn pretty        # Check formatting
```

## License

Apache-2.0
