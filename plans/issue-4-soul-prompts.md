# Plan — Issue #4: Register `--prompts soul` variant

Tracking: https://github.com/SecurityLab-UCD/korabench/issues/4

## Goal

Add a `soul` prompt variant to the `run` command. When selected, KoraBench reads
the target model's system prompt body from `process.env.SOUL_MD_PATH`, falling
back to `data/souls/seed.md` resolved against the repo's `data/` directory. The
file is read once per run, used verbatim, and produces no schema, judge, or
scenario changes.

## Acceptance criteria (from the issue)

- `yarn kora run <target> --prompts soul --limit 1` succeeds when
  `SOUL_MD_PATH` points at a readable markdown file; that body is the system
  prompt in the transcript.
- Same invocation with `SOUL_MD_PATH` unset and `data/souls/seed.md` present
  uses the seed file.
- Same invocation with both unset and missing exits non-zero with a message
  naming `SOUL_MD_PATH`.
- Unit test covers the three branches above.
- No regression to `--prompts default` or `--prompts child`.

## Design choices

1. **Verbatim body, no memory templating.** The soul file is the full system
   prompt. `scenario.modelMemory` is not auto-appended. SOULFuzz owns the
   memory templating decision inside the file body.
2. **Age coupling.** `ScenarioPrompt.toAgeRange` returns `undefined` for
   `"soul"` — the variant is age-agnostic by construction.
3. **Read-once.** File resolution happens in `cli.ts` before `runCommand` is
   invoked. The string is threaded down to `TestContext`. No per-scenario IO.
4. **Scope.** Only the `run` command. `continueCommand` and `reassessCommand`
   are out of scope for this issue.

## Files to change

### `packages/benchmark/src/model/scenarioPrompt.ts`
- Extend picklist to `["default", "child", "soul"]`.
- `promptToAgeRange("soul", _)` returns `undefined`.

### `packages/benchmark/src/prompts/conversationToNextMessagePrompt.ts`
- Add optional `prompt?: ScenarioPrompt` and `soulBody?: string` to the
  options interface.
- When `prompt === "soul"`: return `{input: soulBody}` verbatim. Throw with a
  clear message if `soulBody` is missing (defensive invariant; the CLI layer
  guarantees this).
- Otherwise: unchanged `ageRange` switch.

### `packages/benchmark/src/benchmark.ts`
- Add optional `soulBody?: string` to `TestContext`. Only consumed when the
  test key's prompt is `"soul"`.

### `packages/benchmark/src/kora.ts`
- In `runTest` and `runJudges`, pass `prompt: key.prompt` and
  `soulBody: c.soulBody` into `conversationToNextMessagePrompt`.
- Add a runtime check: `key.prompt === "soul"` with `c.soulBody === undefined`
  throws naming `SOUL_MD_PATH`.

### `packages/cli/src/commands/shared/resolveSoulBody.ts` (new)
- Exported function `resolveSoulBody(dataPath: string): string`:
  1. If `process.env.SOUL_MD_PATH` is set, read it. Missing/unreadable → throw
     with a message naming `SOUL_MD_PATH` and the failing path.
  2. Else read `path.join(dataPath, "souls", "seed.md")`. Missing → throw
     with a message naming both `SOUL_MD_PATH` and the seed path.
- Pure (no side effects beyond file IO).

### `packages/cli/src/commands/shared/buildContext.ts`
- Accept `soulBody?: string`; forward it onto the returned `TestContext`.

### `packages/cli/src/commands/runCommand.ts`
- Extend `RunCommandOptions` with `soulBody?: string`.
- Forward through `buildContext` so every `runTest` call sees the same string.

### `packages/cli/src/cli.ts`
- Update `--prompts` help text to include `soul`.
- After parsing the prompt list, if it contains `"soul"`, call
  `resolveSoulBody(dataPath)` and pass the result into `runCommand` via
  `options.soulBody`. Errors propagate so the process exits non-zero with the
  underlying message.

## Tests

### `packages/cli/src/commands/shared/__tests__/resolveSoulBody.test.ts` (new)
- `SOUL_MD_PATH` set & readable → returns file contents.
- `SOUL_MD_PATH` unset, seed present → returns seed contents.
- Both missing → throws naming `SOUL_MD_PATH`.

### `packages/benchmark/src/prompts/__tests__/conversationToNextMessagePrompt.test.ts` (new or extended)
- `prompt: "soul", soulBody: "X"` → `{input: "X"}`.
- `prompt: "soul"` without `soulBody` → throws.
- Existing `default` / `child` cases remain green.

## Verification

- `yarn tsbuild` for typecheck (CLAUDE.md required check).
- `yarn test` for unit tests.
- Manual smoke:
  - `SOUL_MD_PATH=/tmp/soul.md yarn kora run <slug> --prompts soul --limit 1`
  - `unset SOUL_MD_PATH; cp <child-body> data/souls/seed.md; yarn kora run ...`
  - `unset SOUL_MD_PATH; rm -f data/souls/seed.md; yarn kora run ...` (expect
    non-zero exit naming `SOUL_MD_PATH`).
- `--prompts default` and `--prompts child` smoke runs to confirm no
  regression.

## Out of scope

- HCB judge registration (SOULFuzz touch point #4).
- `custom-cfa-*` model slugs and `packages/cfa/` workspace.
- `intimacyCalibration` mechanism.
- Wiring `soul` through `continueCommand` / `reassessCommand`.
- Persisting the soul body / hash into the result JSON.
