# KORA Benchmark

The first public benchmark for AI child safety. Learn more at [korabench.ai](https://korabench.ai).

## Overview

KORA measures the safety of AI models interacting with children across 8 risk categories, 25 individual risks, 3 age groups (7–9, 10–12, 13–17), and 10 child motivations. It produces per-risk grades — failing, adequate, or exemplary — for both safety and three behavioral criteria.

The benchmark uses a 3-stage pipeline: **seed generation** creates short scenario outlines from the risk taxonomy, **scenario expansion** turns each seed into a detailed test scenario with validation, and **test runs** execute multi-turn conversations and judge the results.

Each test is a 3-turn conversation between a simulated child user and the target model. A judge model then evaluates the conversation on safety and on three behavioral criteria: anthropomorphism, epistemic humility, and human redirection. Scenarios can be tested with different prompt variants — `default` (no age context in the system prompt) and `child` (age-aware system prompt) — controlled via the `--prompts` flag.

## Prerequisites

- **Node.js 25+**
- **Yarn**
- **AI Gateway API key** — set the `AI_GATEWAY_API_KEY` environment variable for the AI SDK gateway. Copy `.env.example` to `.env` and fill in your key.

## Getting started

Install dependencies and build:

```bash
cp .env.example .env   # then add your API key
yarn && yarn tsbuild
```

Run the benchmark with pre-built scenarios:

```bash
yarn kora run <target-model>
```

For example, to evaluate `gpt-4o`:

```bash
yarn kora run gpt-4o
```

## Pipeline stages

### `generate-seeds`

Generates a set of scenario seeds from the risk taxonomy.

```bash
yarn kora generate-seeds [model]
```

| Argument / Option | Description |
|---|---|
| `[model]` | Model to use for seed generation (default: `gpt-5.2:high`) |
| `-o, --output <path>` | Output JSONL file (default: `data/scenarioSeeds.jsonl`) |
| `--seeds-per-task <count>` | Seeds per risk/age/motivation combination (default: `8`) |

### `expand-scenarios`

Transforms seeds into fully fleshed-out scenarios with validation.

```bash
yarn kora expand-scenarios [model] [user-model]
```

| Argument / Option | Description |
|---|---|
| `[model]` | Model to use for scenario expansion (default: `gpt-4o`) |
| `[user-model]` | Model to use for generating the first user message (default: `deepseek-v3`) |
| `-i, --input <path>` | Input seeds JSONL file (default: `data/scenarioSeeds.jsonl`) |
| `-o, --output <path>` | Output scenarios JSONL file (default: `data/scenarios.jsonl`) |

### `run`

Runs the benchmark against the target model.

```bash
yarn kora run <target-model> [judge-model] [user-model]
```

| Argument / Option | Description |
|---|---|
| `<target-model>` | Model to benchmark |
| `[judge-model]` | Model to use as judge (default: `gpt-5.2:high:limited`) |
| `[user-model]` | Model to use for simulating the child user (default: `deepseek-v3`) |
| `-i, --input <path>` | Input scenarios JSONL file (default: `data/scenarios.jsonl`) |
| `-o, --output <path>` | Output results JSON file (default: `data/results.json`) |
| `--prompts <prompts>` | Comma-separated prompt variants to test (default: `default`) |

All commands write to `data/` by default. Commands are restartable — progress is tracked via temp files so interrupted runs resume where they left off.

## Model configuration

### Model registry (`models.json`)

Models are configured in a `models.json` file at the project root. The CLI searches for this file starting from the current directory and walking up. Each entry maps a **model slug** (used on the command line) to its configuration:

```json
{
  "gpt-5.2:high": {
    "model": "openai/gpt-5.2",
    "providerOptions": {
      "openai": {
        "reasoningEffort": "high"
      }
    }
  },
  "deepseek-v3": {
    "model": "deepseek/deepseek-v3",
    "maxTokens": 4000,
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

To add a custom model, edit `customModel.ts` and implement the `Model` interface:

```ts
export async function createCustomModel(modelSlug: string, _scenario: Scenario): Promise<Model> {
  return {
    async getTextResponse(request) {
      // request.messages contains the conversation (system, user, assistant messages).
      // request.maxTokens and request.temperature are optional hints.
      // Return the model's text response.
      throw new Error(`Custom model "${modelSlug}" is not implemented.`);
    },

    async getStructuredResponse(request) {
      // request.outputType is the Valibot schema for the expected output.
      // Return a parsed object matching the schema.
      throw new Error(`Custom model "${modelSlug}" is not implemented.`);
    },
  };
}
```

The factory receives:
- `modelSlug` — the full slug (e.g. `custom-my-model`), so you can route to different backends.
- `scenario` — the current `Scenario` being tested, available for context-aware implementations.

Both `getTextResponse` and `getStructuredResponse` are available — custom models can serve as the target model and, with a structured response implementation, as the judge too.

A new `Model` instance is created per scenario, so you can use the scenario data to customize behavior.

Then use the slug on the command line like any other model:

```bash
yarn kora run custom-my-model
```

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
  "target": "gpt-4o",
  "judge": "gpt-5.2:high:limited",
  "user": "deepseek-v3",
  "prompts": ["default"],
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
| `target` | Target model slug |
| `judge` | Judge model slug |
| `user` | User model slug |
| `prompts` | Prompt variants that were tested |
| `sums.al` | Total test count |
| `sums.as` | Safety grades: `[failing, adequate, exemplary]` |
| `sums.an` | Anthropomorphism: `[failing, adequate, exemplary, occurrenceCount]` |
| `sums.eh` | Epistemic humility: `[failing, adequate, exemplary, occurrenceCount]` |
| `sums.hr` | Human redirection: `[failing, adequate, exemplary, occurrenceCount]` |

Scores are grouped by risk category, risk, age range, and prompt variant. Two prompt variants are available:

- **`default`** — no age context in the system prompt.
- **`child`** — the system prompt includes the child's age range.

Use `--prompts default,child` to test both variants.

## Cost and duration

Each pipeline stage makes the following API calls:

- **Seed generation**: 1 call per (risk x age range x motivation) combination = 25 x 3 x 10 = **750 calls**, producing 8 seeds each (6,000 seeds total).
- **Scenario expansion**: 3–5 calls per seed (1 generate + 1 validate + 1 first user message on pass; up to 2 generate + 2 validate + 1 first user message on retry).
- **Test run**: 7 calls per test (2 user responses + 3 target model responses + 2 judge responses), with 1 test per scenario per prompt variant.

All commands run with a concurrency of 10 parallel tasks.

## Project structure

```
.env.example                         Environment variable template
models.json                          Model registry configuration
data/                                Scenario pipeline output (seeds, scenarios, results)
packages/
  benchmark/
    data/                            Risk taxonomy and motivations (risks.json, motivations.json)
    src/                             Core benchmark logic
      prompts/                       Prompt templates for each pipeline stage
      model/                         Domain types (scenario, risk, assessment, etc.)
      __tests__/                     Test suites
      benchmark.ts                   Core benchmark interface
      generateUserMessage.ts         User message generation
      kora.ts                        KORA benchmark implementation
  cli/src/                           CLI package
    commands/                        CLI command implementations
    __tests__/                       CLI test suites
    model.ts                         Model interface definition
    gatewayModel.ts                  AI SDK gateway model implementation
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
