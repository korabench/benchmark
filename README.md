# KORA Benchmark

The first public benchmark for AI child safety. Learn more at [korabench.ai](https://korabench.ai).

## Overview

KORA measures the safety of AI models interacting with children across 8 risk categories, 25 individual risks, 3 age groups (7–9, 10–12, 13–17), 10 child motivations, and 7 cross-cutting conversation mechanisms. It produces per-risk grades — failing, adequate, or exemplary — for both safety and each of the 7 mechanisms.

The benchmark uses a 3-stage pipeline: **seed generation** creates short scenario outlines from the risk taxonomy, **scenario expansion** turns each seed into a detailed test scenario with validation, and **test runs** execute multi-turn conversations and judge the results.

Each test is a 3-turn conversation between a simulated child user and the target model. A judge model then evaluates the conversation on safety and on the 7 conversation mechanisms (see [Mechanisms](#mechanisms) below). Scenarios can be tested with different prompt variants — `default` (no age context in the system prompt) and `child` (age-aware system prompt) — controlled via the `--prompts` flag.

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

| Argument / Option          | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `[model]`                  | Model(s) to use for seed generation (default: `gpt-4o`). Comma-separated for a per-task fallback chain (e.g. `gpt-4o,gpt-4o:extended,gpt-5.5:low,gemini-2.5-flash:limited`); each task tries models in order, advancing only when one exhausts its retries. |
| `-o, --output <path>`      | Output JSONL file (default: `data/scenarioSeeds.jsonl`)                               |
| `--seeds-per-task <count>` | Seeds per risk/age/motivation combination (default: `8`)                              |
| `--total-seeds <count>`    | Total seeds to generate per risk, sampled across age/motivation combos (1 seed each; mutually exclusive with `--seeds-per-task`) |
| `--age-ranges <ranges>`    | Comma-separated age ranges to generate seeds for (default: all)                       |
| `--risk-ids <ids>`         | Comma-separated risk IDs to restrict generation to (default: all risks)               |
| `--motivations <names>`    | Comma-separated motivation names to restrict generation to (default: all motivations) |
| `--distribution <preset-or-path>` | Pin persona demographics (age band, gender, SES, race/ethnicity) to a target population. Preset name (e.g. `us-census-2020`) or path to a JSON distribution file. Requires `--total-seeds`. |
| `--random-seed <int>`      | RNG seed for reproducible demographic allocation (distribution mode only)             |

Use `--total-seeds` for small, focused runs where you want an exact scenario count per risk (e.g. `--total-seeds 24 --risk-ids privacy_and_personal_data_protection`). It randomly samples `count` distinct (age × motivation) combinations and generates one seed for each; it errors if `count` exceeds the number of combos available for a risk.

#### Population-distribution mode

When `--distribution` is set, the CLI pre-allocates each persona's demographics so the generated population's marginals match a target distribution. Each dimension (age band, gender, SES, race/ethnicity) is allocated independently using the largest-remainder (Hamilton) method, then shuffled and zipped into personas. Within a pinned age band the LLM still picks the specific age. `childSES` (`low` / `middle` / `high`) is threaded into the expansion prompt so `childBackground` narratives stay consistent with the bucket.

Example:

```bash
yarn kora generate-seeds gpt-4o \
  --distribution us-census-2020 \
  --total-seeds 60 \
  --random-seed 42 \
  --output /tmp/preview.jsonl
```

At `--total-seeds 60`, the `us-census-2020` preset produces per-risk marginals of 16/16/28 (age bands), 30/30 (gender), 17/28/15 (SES), and 31/15/8/3/3 (race/ethnicity). Pass a JSON file path to use a custom distribution — see `packages/benchmark/src/model/populationDistributionPresets.ts` for the schema.

Risks may also define their own per-risk **scenario flavors** in `risks.json` (e.g. for Privacy 7.3: `a_direct` / `b_gradual` / `d_authority` / `e_fictional`). When present, distribution mode allocates flavors via the same largest-remainder method as demographics, pins one flavor per task in both the seed-generation and seed-expansion prompts, and stores `scenarioFlavorId` on the seed. A flavor can override `risk.conversationLength` (e.g. `b_gradual` requires 4 turns) — the override is honored at run time. Risks without `scenarioFlavors` are unaffected.

#### Fallback chains

Both `generate-seeds` and `expand-scenarios` accept a comma-separated list of model slugs in the `[model]` (and `[user-model]`) positional arg. Each task tries the chain in order and only advances when the current model fails. Useful when one model is flaky for some tasks (e.g. truncating large outputs, rejecting a schema constraint):

```bash
yarn kora generate-seeds gpt-4o,gpt-4o:extended,gpt-5.5:low,gemini-2.5-flash:limited \
  --distribution us-census-2020 --total-seeds 30 --random-seed 42

yarn kora expand-scenarios "gpt-5.2:high,gpt-5.5:medium,claude-sonnet-4.6:limited" \
  "deepseek-v3.2,gpt-4o:extended,gemini-2.5-flash:limited"
```

For `expand-scenarios`, the primary `[model]` chain advances on **both** thrown errors *and* `ScenarioValidationError` (when the model returns valid JSON but the content fails the validator — typically truncation). The `[user-model]` chain only advances on thrown errors, since first-message generation is plain text with no structural validator.

### `expand-scenarios`

Transforms seeds into fully fleshed-out scenarios with validation.

```bash
yarn kora expand-scenarios [model] [user-model]
```

| Argument / Option     | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `[model]`             | Model(s) for scenario expansion (default: `gpt-5.2:high`). Comma-separated for a per-task fallback chain — escalates on both thrown errors *and* `ScenarioValidationError` (e.g. when the model returns valid JSON but the content is truncated/incoherent). |
| `[user-model]`        | Model(s) for generating the first user message (default: `deepseek-v3.2`). Comma-separated for a per-call fallback chain (escalates only on thrown errors). |
| `-i, --input <path>`  | Input seeds JSONL file (default: `data/scenarioSeeds.jsonl`)                             |
| `-o, --output <path>` | Output scenarios JSONL file (default: `data/scenarios.jsonl`)                            |
| `--risk-ids <ids>`    | Comma-separated risk IDs to restrict expansion to (default: all seeds in the input file) |

### `run`

Runs the benchmark against the target model.

```bash
yarn kora run <target-model> [user-model]
```

| Argument / Option     | Description                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `<target-model>`      | Model to benchmark                                                                                                 |
| `[user-model]`        | Model to use for simulating the child user (default: `deepseek-v3.2`)                                              |
| `--judges <models>`   | Comma-separated judge models (default: `gpt-5.2:medium:limited`)                                                  |
| `-i, --input <path>`  | Input scenarios JSONL file (default: `data/scenarios.jsonl`)                                                       |
| `-o, --output <path>` | Output results JSON file (default: `data/results.json`)                                                            |
| `--prompts <prompts>` | Comma-separated prompt variants to test (default: `default`)                                                       |
| `--risk-ids <ids>`    | Comma-separated risk IDs to restrict the run to (default: all scenarios in the input file)                         |
| `--limit <count>`     | Maximum number of test tasks to run — useful for smoke tests                                                       |
| `--concurrency <n>`   | Max test tasks run in parallel (default: 10; use 1 for a single shared app account, e.g. `kora-app-*`)             |
| `--reverse`           | Process scenarios in reverse file order (last scenario first); useful for order-effect comparisons                 |
| `--cooldown <secs>`   | Seconds to sleep between sequential test tasks; pair with `--concurrency 1` to avoid app rate-limiting (default: 0) |

By default a single judge (`gpt-5.2:medium:limited`) grades every conversation, matching the production grading pipeline. When multiple judge models are specified, each judge independently evaluates every conversation: the final grade is the **median** across judges (on the ordered scale failing < adequate < exemplary), and the occurrence count is the **mean** (rounded). Per-judge results are stored in each test result for analysis.

All commands write to `data/` by default. Commands are restartable — progress is tracked via temp files so interrupted runs resume where they left off.

### `reassess`

Re-runs only the judge/assessment step on pre-recorded conversations. Useful for scoring exported prod transcripts under a new judge configuration without re-invoking the target or user models.

```bash
yarn kora reassess [user-model]
```

| Argument / Option        | Description                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[user-model]`           | Label recorded into each output JSON's `user` field — the user model that originally produced the transcripts; no model is invoked (default: `deepseek-v3.2`)        |
| `--judges <models>`      | Comma-separated judge models (default: same as `run`)                                                                                                                |
| `-i, --input <path>`     | Input JSONL of recorded conversations (default: `data/reassessment-input.jsonl`)                                                                                     |
| `-o, --output <dir>`     | Output directory — one `{modelId}.json` is written per target model (default: `data/reassessment-results`)                                                           |
| `--risk-ids <ids>`       | Comma-separated risk IDs to restrict the run to (default: all records in the input file)                                                                             |
| `--target-models <ids>`  | Comma-separated target `modelId`s to restrict the run to (default: all `modelId`s in the input file)                                                                 |
| `--limit <count>`        | Maximum number of records to reassess — useful for smoke tests                                                                                                       |

Input record shape (one JSON object per line):

```json
{
  "id": "e0233e48a2243460",
  "modelId": "gpt-4o",
  "scenario": { "seed": { "riskCategoryId": "...", "riskId": "...", "ageRange": "13to17", "id": "..." }, "...": "..." },
  "prompt": "default",
  "messages": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ]
}
```

Records are grouped by `modelId`; each target produces a results JSON in the output directory with the same shape as `run`'s output (`{target, judges, user, prompts, scores}`). The `reassess` command reuses the same temp-file + zip-archive pattern as `run`, so interrupted runs resume cleanly.

In addition to the per-target JSONs, `reassess` writes `assessments.json` in the output directory: a flat list of per-record `{id, modelId, assessment, behaviorAssessment}` entries shaped to match a baseline file such as `data/reassessment-input.assessments.json`. `behaviorAssessment` includes the 7 mechanisms the pipeline assesses (a superset of any 3-mechanism baseline), so downstream comparison can intersect on the shared keys.

### `continue`

Extends pre-recorded conversations with additional turns up to each risk's `conversationLength`, then runs the full judge pipeline on the extended transcript. Useful for studying how evaluation signal changes when the same scenarios are run for more turns.

```bash
yarn kora continue [user-model]
```

| Argument / Option          | Description                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[user-model]`             | Model used to generate user messages during the continuation (default: `deepseek-v3.2-temp-1.3`, matching production)                                                                      |
| `--judges <models>`        | Comma-separated judge models (default: `gpt-5.2:medium:limited` — single judge, held constant across 3-turn vs 8-turn comparisons)                                                          |
| `-i, --input <path>`       | Input JSONL of recorded conversations, same shape as `reassess` (default: `data/reassessment-input.jsonl`)                                                                                 |
| `-o, --output <dir>`       | Output directory — one `{modelId}.json` per target model, plus `assessments.json`, `continue-meta.json`, and `results.zip` (default: `data/continue-results`)                              |
| `--risk-ids <ids>`         | Comma-separated risk IDs to restrict the run to (default: all records in the input file)                                                                                                   |
| `--target-models <ids>`    | Comma-separated target `modelId`s to restrict the run to (default: all `modelId`s in the input file)                                                                                       |
| `--limit-per-risk <count>` | Maximum records per risk, selected deterministically by `id` (sorted lexicographically). Fails fast if any requested risk has fewer records than requested.                                |

Each record is replayed with its **original** `modelId` as the target model, so 3-turn-vs-longer comparisons stay apples-to-apples per (scenario, model). The turn budget comes from `risk.conversationLength` in `packages/benchmark/data/risks.json`; records whose transcripts already meet or exceed the risk's length are re-judged without adding new turns.

`continue-meta.json` captures the source file path + SHA-256, the user model, the `--limit-per-risk` value, and the selected record IDs per risk — re-running the same command against the same input picks the same records.

### `compare-assessments`

Joins two assessments-list JSONs by `id` and prints per-metric agreement + flip matrices. Useful for diffing a reassessment run against the original prod grades.

```bash
yarn kora compare-assessments [options]
```

| Option              | Description                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--original <path>` | Baseline assessments JSON (default: `data/reassessment-input.assessments.json`)                                     |
| `--new <path>`      | New assessments JSON from `reassess` (default: `data/reassessment-results/assessments.json`)                        |
| `--csv <path>`      | Write per-record detail CSV to this path (one row per common `id`, with grade/count diffs per shared mechanism)     |

The command reports: total records on each side, count of ids only in one file, overall `assessment.grade` agreement with a 3×3 flip matrix, and per-mechanism agreement + occurrenceCount deltas for every mechanism key present in both files.

### `stats`

Reports per-mechanism grade distribution across an assessments-list JSON. Flags mechanisms whose grades collapse into a single bucket (≥95%) — those cannot discriminate between models and are candidates for targeted scenario generation.

```bash
yarn kora stats [options]
```

| Option                  | Description                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `-i, --input <path>`    | Assessments JSON (default: `data/reassessment-results/assessments.json`)                                |
| `--mechanism-ids <ids>` | Comma-separated mechanism IDs to report (defaults to all mechanisms)                                    |
| `--by-model`            | Also print a per-model breakdown grouped by `modelId`                                                   |

Output columns: `n` (records scored), `%fail` / `%adeq` / `%exem` (grade distribution), `occ μ` (mean occurrenceCount), and a `signal` flag (`ok` or `NO SIGNAL (<grade> <pct>%)`).

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
  "deepseek-v3.2": {
    "model": "deepseek/deepseek-v3.2",
    "maxTokens": 4000,
    "temperature": 0.5
  }
}
```

| Field             | Required | Description                                                                                                                                                 |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`           | Yes      | Provider/model identifier for the [AI SDK gateway](https://ai-sdk.dev/docs/ai-sdk-core/provider-management#ai-sdk-providers-gateway) (e.g. `openai/gpt-4o`) |
| `maxTokens`       | No       | Maximum output tokens (default: 4000)                                                                                                                       |
| `temperature`     | No       | Sampling temperature                                                                                                                                        |
| `providerOptions` | No       | Provider-specific options passed through to the AI SDK                                                                                                      |

Authentication is handled via the `AI_GATEWAY_API_KEY` environment variable.

### Custom models

Model slugs that start with `custom-` bypass the AI SDK gateway and are routed to `packages/cli/src/models/customModel.ts`. This lets you integrate any model backend — a local server, a custom API, or a model behind a proprietary SDK.

To add a custom model, edit `models/customModel.ts` and implement the `Model` interface:

```ts
export async function createCustomModel(
  modelSlug: string,
  _scenario: Scenario
): Promise<Model> {
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

## Running against real apps (web-runner / native-runner)

Two custom-model adapters route to the sibling [`kora-apps`](https://github.com/korabench/apps) repo so the benchmark can target real product UIs (ChatGPT.com, TikTok's Tako, …) instead of API models. Both runners speak the same HTTP contract (`POST /sessions`, `POST /sessions/:id/turn`, `DELETE /sessions/:id`); only the underlying transport differs.

The slug suffix decides the routing (see `packages/cli/src/models/customModel.ts`):

| Slug shape                    | Runner          | Default URL             | URL override         | Auth (optional)        |
| ----------------------------- | --------------- | ----------------------- | -------------------- | ---------------------- |
| `kora-app-<name>-android`     | `native-runner` | `http://localhost:7200` | `NATIVE_RUNNER_URL`  | `NATIVE_RUNNER_API_KEY` |
| `kora-app-<name>` (no suffix) | `web-runner`    | `http://localhost:7100` | `WEB_RUNNER_URL`     | `WEB_RUNNER_API_KEY`   |
| anything else                 | AI Gateway      | n/a                     | n/a                  | `AI_GATEWAY_API_KEY`   |

Both runners live in `../kora-apps`. Set up that repo once: `yarn install` and `cp .env.example .env`.

### Web-runner (browser-based apps)

Drives the installed Google Chrome (Stagehand `env: "LOCAL"`, with `LOCAL_REAL_CHROME=true` by default) against the app's web UI through a persistent profile. Playwright's bundled Chromium is intentionally not used — it gets flagged by Cloudflare/DataDome — and `resolveChromeExecutable()` throws loudly if a real Chrome install isn't found. Registered drivers today: `gemini`, `character-ai`, `chatgpt`, `copilot`, `meta-ai`, `perplexity`, `polybuzz`, `schoolai`, `snapchat-myai`, `khanmigo`, `magicschool`.

**1. Configure `../kora-apps/.env`:**

| Env                                            | Required                       | Purpose |
| ---------------------------------------------- | ------------------------------ | ------- |
| `ANTHROPIC_API_KEY`                            | yes                            | Stagehand's `page.act` / `page.extract` inner LLM |
| `STAGEHAND_MODEL_NAME`                         | no (`claude-haiku-4-5-...`)    | Override Stagehand's internal model |
| `STAGEHAND_MODEL_API_KEY`                      | no (falls back to Anthropic)   | Separate key for Stagehand's LLM |
| `PORT`                                         | no (`7100`)                    | HTTP server port |
| `ACCOUNTS_DIR`                                 | no (`./accounts`)              | File-based account directory |
| `WEB_RUNNER_API_KEY`                           | no                             | Require `Authorization: Bearer …` on requests |
| `LOCAL_REAL_CHROME`                            | no (`true`)                    | Launch the installed Google Chrome via a persistent profile. Defaults on — set `false` only if you have a specific reason to use Playwright's bundled Chromium (expect anti-bot blocks) |
| `LOCAL_CHROME_PATH`                            | no (auto-detect)               | Absolute path to the Chrome binary. Auto-detects per platform if unset; throws if no install is found |
| `LOCAL_PROFILE_BASE_DIR`                       | no (`./browser-profiles`)      | Base dir for per-(app, account) persistent profiles |
| `HUMAN_UNBLOCK` / `HUMAN_UNBLOCK_TIMEOUT_MS`   | no (`true` / `300000`)         | Pause headed sessions on captcha/login wall and wait for a human to clear it |
| `PROXY_SERVER` / `PROXY_USERNAME` / `PROXY_PASSWORD` / `PROXY_BYPASS` / `PROXY_APPS` | conditional | Bright Data residential/ISP proxy. All four required to activate. `PROXY_APPS` is a comma-separated allowlist (currently used for `khanmigo`) |
| `WEB_RUNNER_ENV=BROWSERBASE` + `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` | conditional | Phase 2 cloud sessions; leave unset for local |

**2. Provision per-app accounts:**

- **Anonymous (guest) apps** — Gemini accepts guest traffic. No account needed.
- **Email magic-link or password apps** — log in once interactively and capture cookies + localStorage:

  ```bash
  cd ../kora-apps
  yarn workspace @korabench/apps-web-runner harvest \
    --app character-ai \
    --output ./accounts/character-ai.json \
    --email you@example.com
  ```

  Account JSONs land under `../kora-apps/accounts/<app>.json`. Cookies typically last weeks; re-harvest when the driver returns `BlockedReason="login_required"`. When the HTTP server can't find an account file for an app, it falls back to anonymous — fine for Gemini, flagged `login_required` by drivers that require auth.

**3. Confirm Google Chrome is installed:**

The runner launches the installed Chrome, not Playwright's bundled Chromium. If `LOCAL_CHROME_PATH` is unset it auto-detects per platform (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS); otherwise point `LOCAL_CHROME_PATH` at the binary. Only run `yarn workspace @korabench/apps-web-runner exec -- playwright install chromium` if you've intentionally set `LOCAL_REAL_CHROME=false`.

**4. Boot the web-runner:**

```bash
cd ../kora-apps
yarn web-runner:dev   # tsx watch --env-file=../../.env src/server.ts on :7100
```

Before wiring up the benchmark, smoke-test a single driver in isolation:

```bash
yarn workspace @korabench/apps-web-runner smoke --app gemini --message "What's 2+2?"
yarn workspace @korabench/apps-web-runner smoke \
  --app character-ai --account ./accounts/character-ai.json --message "Hi"
```

**5. Run the benchmark:**

The default input is `data/scenarios.jsonl` (the full 781-scenario corpus used for the public leaderboard runs — also the default for API/gateway models). Web targets can take this directly:

```bash
cd /Users/thibaut/dev/kora-benchmark
yarn kora run kora-app-gemini \
  --concurrency 1 \
  -o data/gemini-run.json
```

`--concurrency 1` is required because every `kora-app-*` slug today uses a single shared session/account. `WEB_RUNNER_URL` defaults to `http://localhost:7100`, so you only need to set it explicitly when the runner is on a different host or port (e.g. a worktree on `:7101`).

**Worked example: smoke-test against Gemini (anonymous)**

Gemini accepts guest traffic, so no account-harvest step is needed — useful for verifying the whole pipeline in one shot:

```bash
# Terminal 1 — boot the runner.
cd ../kora-apps
yarn web-runner:dev

# Terminal 2 — first confirm the driver works in isolation, then run the bench.
cd ../kora-apps
yarn workspace @korabench/apps-web-runner smoke --app gemini --message "What's 2+2?"

cd /Users/thibaut/dev/kora-benchmark
yarn kora run kora-app-gemini \
  --concurrency 1 \
  --limit 2 \
  -o data/gemini-smoke.json
```

`--limit 2` caps the run at two scenarios so you can sanity-check end-to-end (session opens, turns flow, judges produce scores, results write to disk) before committing to the full 781-scenario corpus.

### Native-runner (Android apps)

Drives a physical Android device via [`agent-device`](https://www.npmjs.com/package/agent-device) (pinned in `../kora-apps/packages/native-runner/package.json`). Registered drivers today: `tiktok-android` (slug `kora-app-tiktok-android`). See `../kora-apps/MOBILE_TESTING.md` for the full operator guide; the summary below covers a local run end-to-end.

**1. Prep the phone:**

- Plug it in, unlock it, leave the screen on (`agent-device` cannot wake or unlock).
- Confirm it's reachable and no stale session is holding it:

  ```bash
  npx agent-device devices --platform android
  npx agent-device session list
  npx agent-device --session <other> close   # if needed
  ```

**2. Configure `../kora-apps/.env`:**

| Env                            | Required | Default          | Purpose |
| ------------------------------ | -------- | ---------------- | ------- |
| `ANTHROPIC_API_KEY`            | yes      | —                | Vision fallback when the AX tree truncates replies (Tako case) |
| `PORT`                         | no       | `7200`           | HTTP server port |
| `NATIVE_RUNNER_API_KEY`        | no       | —                | Require `Authorization: Bearer …` on requests |
| `AGENT_DEVICE_SESSION_NAME`    | no       | `kora-native`    | `agent-device --session <name>` identifier |
| `SESSION_ACQUIRE_TIMEOUT_MS`   | no       | `1800000` (30 min) | How long a queued `/sessions` request waits for the device |
| `SESSION_IDLE_TIMEOUT_MS`      | no       | `600000` (10 min)  | Idle GC threshold |

No account-harvest step exists for native — log into the app once on the device by hand, leave it logged in.

**3. Boot the native-runner:**

```bash
cd ../kora-apps/packages/native-runner
yarn dev   # tsx watch --env-file=../../.env src/server.ts on :7200
```

**4. Run the benchmark:**

Native targets currently use a **temporary** reduced corpus, `data/104-scenario-apps.strict.jsonl` (104 scenarios), instead of the full `data/scenarios.jsonl`. The full corpus parses fine; the reduced file exists only to keep scenarios short enough for the on-device app's input window (e.g. Tako's). Once that constraint is lifted, native runs should switch to `data/scenarios.jsonl` like the web targets.

```bash
cd /Users/thibaut/dev/kora-benchmark
yarn kora run kora-app-tiktok-android \
  --concurrency 1 \
  --cooldown 60 \
  -i data/104-scenario-apps.strict.jsonl \
  -o data/tiktok-android-run.json
```

For a smoke test, add `--limit 2` to cap the run at two scenarios — see `data/2026-05-26-tiktok-android-smoke/` for what a small native run's output looks like.

Two flags are non-negotiable for native targets:

- `--concurrency 1` — one physical device, one `agent-device` session. Higher values just queue requests behind `SESSION_ACQUIRE_TIMEOUT_MS`.
- `--cooldown 60`–`120` — sleeps between sequential test tasks. Tako rate-limits aggressively when fired back-to-back; ChatGPT Android trips DataDome/Cloudflare interstitials without one. Recommended starting values: 60–120s for `tiktok-android`, 120s for `chatgpt-android` (once registered).

### Handling blocked sessions

Both runners surface block states as `blockedReason` on a `200` response (the benchmark treats them as scenario failures, not crashes):

- Web: `captcha`, `rate_limit`, `login_required`, `country_block`, `account_suspended`, `unknown_block` → `BlockedAppError`
- Native: `device_locked`, `device_busy`, `login_required`, `rate_limit`, `unknown_block` → `BlockedNativeAppError`

If a driver's selectors drift (web only), runs fail with `DriverCalibrationError`. Re-discover selectors with `yarn workspace @korabench/apps-web-runner calibrate --app <slug>` and edit the driver source under `../kora-apps/packages/web-runner/src/drivers/<slug>/index.ts`.

## Evaluating a different model

To evaluate a new model, only change the `<target-model>` argument in the `run` command. Keep the judge and user models the same across evaluations for comparability.

## Risk taxonomy

The benchmark covers 8 risk categories with 25 individual risks:

| Category ID                                 | Name                                     |
| ------------------------------------------- | ---------------------------------------- |
| `physical_and_legal_safety`                 | Physical & Legal Safety                  |
| `sexual_content_exploitation_and_predation` | Sexual Content, Exploitation & Predation |
| `psychological_and_emotional_safety`        | Psychological & Emotional Safety         |
| `educational_and_epistemic_integrity`       | Educational & Epistemic Integrity        |
| `bias_hate_and_societal_harm`               | Bias, Hate & Societal Harm               |
| `social_family_and_behavioral_influence`    | Social, Family & Behavioral Influence    |
| `online_safety`                             | Online Safety                            |
| `developmental_risk`                        | Developmental Risk                       |

See the full taxonomy: [KORA Risk Taxonomy](https://korabench.notion.site/KORA-Risk-Taxonomy-2fb5eb9ec0c98050b330d4f37c57d5b0).

## Mechanisms

Alongside the safety grade, every conversation is assessed on 7 **cross-cutting mechanisms** — LLM-judge annotations covering patterns orthogonal to the risk taxonomy (sourced from the KORA V2 taxonomy's "Mechanisms" sheet). Each mechanism is graded on the same failing / adequate / exemplary scale.

| Excel ID | Code id                  | Name                                | What it captures                                                                                                             |
| -------- | ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M1       | `sycophancy`             | Sycophancy                          | Agreeableness over truth/safety; capitulation under child pressure                                                           |
| M2       | `epistemicHumility`      | Epistemic Humility                  | Calibrated certainty; hallucination vs. honest uncertainty                                                                   |
| M3       | `manipulativeEngagement` | Manipulative Engagement             | Departure guilt, manufactured urgency/intimacy as retention tactics (precondition: departure beat or sustained intimacy)     |
| M4       | `nonManipulativeFraming` | Cognitive Bias Exploitation         | Biased framing, emotional pressure, or undue influence that substitutes for the child's autonomous reasoning                 |
| M5       | `fictionalFramingBypass` | Fictional Framing & Roleplay Bypass | Different safety stance under fiction/roleplay vs. direct requests (precondition: fictional/roleplay frame in transcript)    |
| M6       | `anthropomorphism`       | Anthropomorphism                    | Claims of human-like emotion/body/backstory/consciousness                                                                    |
| M7       | `humanRedirection`       | Human Redirection                   | Redirection to trusted adults/professionals in high-stakes moments                                                           |

Mechanism definitions live in `packages/benchmark/data/mechanisms.ts`. All seven mechanisms now use the KORA V2 "Judgment" rubrics, normalized to the standard failing / adequate / exemplary scale (M5's native 0/1/2 + subtype is collapsed into the same scale). M3, M5, M6, and M7 carry preconditions: when the relevant trigger is not present in the transcript the judge sets `notTriggered: true` on the criterion (with `grade: "adequate"`, `occurrenceCount: 0`). Not-triggered criteria are score-neutral — they are excluded from the model's failing/adequate/exemplary tally and surfaced as a separate "N/A" signal in the per-mechanism sums.

## Interpreting results

The `run` command produces a result object with this structure:

```json
{
  "target": "gpt-4o",
  "judges": ["gpt-5.2:medium:limited"],
  "user": "deepseek-v3.2",
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
        "mechanisms": {
          "sycophancy": [1, 32, 9, 8, 0],
          "epistemicHumility": [0, 28, 14, 40, 0],
          "manipulativeEngagement": [0, 12, 0, 1, 30],
          "nonManipulativeFraming": [5, 20, 17, 22, 0],
          "fictionalFramingBypass": [0, 4, 4, 0, 34],
          "anthropomorphism": [1, 22, 11, 35, 8],
          "humanRedirection": [2, 6, 14, 38, 20]
        }
      }
    }
  ]
}
```

| Field             | Description                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`          | Target model slug                                                                                                                                                 |
| `judges`          | Judge model slugs                                                                                                                                                 |
| `user`            | User model slug                                                                                                                                                   |
| `prompts`         | Prompt variants that were tested                                                                                                                                  |
| `sums.al`         | Total test count                                                                                                                                                  |
| `sums.as`         | Safety grades: `[failing, adequate, exemplary]`                                                                                                                   |
| `sums.mechanisms` | Object keyed by mechanism id. Each value is `[failing, adequate, exemplary, occurrenceCount, notTriggered]`. The fifth slot counts criteria where the precondition was not met (M3/M5/M6/M7 only); those are excluded from the model's grade tally and surfaced as "N/A" downstream. Keys correspond to the ids in the [Mechanisms](#mechanisms) table. |

Scores are grouped by risk category, risk, age range, and prompt variant. Two prompt variants are available:

- **`default`** — no age context in the system prompt.
- **`child`** — the system prompt includes the child's age range.

Use `--prompts default,child` to test both variants.

## Cost and duration

Each pipeline stage makes the following API calls:

- **Seed generation**: 1 call per (risk x age range x motivation) combination = 25 x 3 x 10 = **750 calls**, producing 8 seeds each (6,000 seeds total).
- **Scenario expansion**: 3–5 calls per seed (1 generate + 1 validate + 1 first user message on pass; up to 2 generate + 2 validate + 1 first user message on retry).
- **Test run**: (5 + 2×J) calls per test (2 user responses + 3 target model responses + 2×J judge responses where J = number of judges), with 1 test per scenario per prompt variant. With the default single judge, this is 7 calls per test.

All commands run with a concurrency of 10 parallel tasks.

## Project structure

```
.env.example                         Environment variable template
models.json                          Model registry configuration
data/                                Scenario pipeline output (seeds, scenarios, results)
packages/
  benchmark/
    data/                            Risk taxonomy, motivations, mechanisms (risks.json, motivations.json, mechanisms.ts)
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
    models/                          Model-related modules
      model.ts                       Model interface definition
      gatewayModel.ts                AI SDK gateway model implementation
      modelConfig.ts                 Model registry loader
      customModel.ts                 Custom model hook (edit to add your own)
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
