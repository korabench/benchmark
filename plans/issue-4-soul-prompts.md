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
- When `prompt === "soul"`: return `{input: soulBody}` verbatim. Throw if
  `soulBody` is missing — this is the single owner of the "soul requires a
  body" invariant.
- Add an inline comment in the soul branch noting that `scenario.modelMemory`
  is intentionally NOT auto-appended for soul; the file body is the entire
  system prompt and the soul author owns any memory templating.
- Otherwise: unchanged `ageRange` switch.

### `packages/benchmark/src/benchmark.ts`
- Add optional `soulBody?: string` to `TestContext`. Only consumed when the
  test key's prompt is `"soul"`.

### `packages/benchmark/src/kora.ts`
- In `runTest` only, pass `prompt: key.prompt` and `soulBody: c.soulBody`
  into `conversationToNextMessagePrompt`. `runJudges` is untouched — it
  doesn't call `conversationToNextMessagePrompt` and has no access to
  `TestContext`, so it has nothing to thread.
- No runtime check here; the "soulBody required for soul" invariant lives
  in `conversationToNextMessagePrompt` (single owner).

### `packages/cli/src/commands/shared/resolveSoulBody.ts` (new)
- Exported function `resolveSoulBody(dataPath: string): string`:
  1. If `process.env.SOUL_MD_PATH` is set, read it. Missing/unreadable → throw
     with a message naming `SOUL_MD_PATH` and the failing path.
  2. Else read `path.join(dataPath, "souls", "seed.md")`. Missing → throw
     with a message naming both `SOUL_MD_PATH` and the seed path.
  3. After reading, if `body.trim().length === 0` → throw naming the
     resolved path (catches truncated files, bad symlinks, blanked seeds).
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
- `SOUL_MD_PATH` set but file unreadable → throws naming `SOUL_MD_PATH` and
  the failing path (typo / moved-file case).
- `SOUL_MD_PATH` unset, seed present → returns seed contents.
- Both missing → throws naming `SOUL_MD_PATH`.
- Empty / whitespace-only body (either source) → throws naming the resolved
  path.

### `packages/benchmark/src/prompts/__tests__/conversationToNextMessagePrompt.test.ts` (new or extended)
- `prompt: "soul", soulBody: "X"` → `{input: "X"}`.
- `prompt: "soul"` without `soulBody` → throws.
- Existing `default` / `child` cases remain green.

### `packages/benchmark/src/model/__tests__/scenarioPrompt.test.ts` (new)
- `ScenarioPrompt.toAgeRange("soul", any)` returns `undefined`.
- Existing `default` / `child` mapping remains.

### `packages/benchmark/src/__tests__/runTest.test.ts` (extended)
- Add one integration test: stub `TestContext` with `soulBody = "SOUL_BODY_X"`,
  run a 1-turn scenario with a key whose `prompt === "soul"`, capture the
  system content sent to `getAssistantResponse`, assert it equals
  `"SOUL_BODY_X"` verbatim. Pins the wiring from CLI → TestContext → prompt.

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

## Documentation

- README: add a short paragraph under the existing prompts section noting
  `soul` as a third option, the `SOUL_MD_PATH` / `data/souls/seed.md`
  resolution order, and that the file body is the full system prompt
  (no auto-appended memory).

## Out of scope

- HCB judge registration (SOULFuzz touch point #4).
- `custom-cfa-*` model slugs and `packages/cfa/` workspace.
- `intimacyCalibration` mechanism.
- Wiring `soul` through `continueCommand` / `reassessCommand`. Note:
  `continueCommand` would currently throw on a soul-prompted transcript
  because it calls `conversationToNextMessagePrompt` without `soulBody`;
  `reassessCommand` is unaffected (judge prompts don't use the soul body).
- Persisting the soul body / hash into the result JSON.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 1 arch + 3 code-quality + 2 test-gap, all incorporated |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | No UI surface |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — ready to implement

### Plan changes from this review

- **A1 (arch):** `kora.ts` instruction corrected — `runJudges` is untouched
  (no access to `TestContext`, doesn't call `conversationToNextMessagePrompt`).
- **C1 (quality):** Soul-body invariant lives only in
  `conversationToNextMessagePrompt`. `runTest` just forwards.
- **C2 (quality):** `resolveSoulBody` rejects empty/whitespace bodies.
- **C3 (quality):** Inline comment in soul branch + README note documenting
  that `scenario.modelMemory` is not auto-appended for soul.
- **T1 (test):** Add `runTest` integration test pinning the
  CLI → TestContext → system-prompt wiring for `prompt="soul"`.
- **T2 (test):** Add `resolveSoulBody` test for the
  `SOUL_MD_PATH-set-but-unreadable` case (distinct error from "both missing").
- **T3 (test):** Add empty-body test under `resolveSoulBody`.
- **T4 (test):** Add `scenarioPrompt.test.ts` covering
  `toAgeRange("soul", _) === undefined`.
