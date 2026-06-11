# scripts

Operator tooling for finishing a benchmark run by hand when a target can't be
driven automatically (e.g. an app web-runner that hits a transient backend
error and auto-skips a scenario).

Both scripts import the **built** packages (`packages/*/build/...`), so run
`yarn build` (or `yarn tsbuild`) first, and pass the gateway/runner env with
`node --env-file=.env`. They read `models.json` from the repo root.

## `manual-rerun.mjs` — collect conversations, human-in-the-loop

Drives one scenario at a time: prints the user (child) turn, you paste the app's
reply, and it uses the **same** user-simulator the benchmark uses
(`generateNextUserMessage`) to produce the next turn — so multi-turn
conversations stay faithful to an automated run. Transcripts persist
append-only to `RUN_DIR/manual-reruns.json` (+ a readable `.md`).

Seed `RUN_DIR/manual-reruns.json` with one entry per scenario:
`{scenario, messages: [{role: "user", content: <firstUserMessage>}]}`.

```sh
RUN_DIR=data/<run> node --env-file=.env scripts/manual-rerun.mjs <idx> [assistantFile]
#   <idx>           1-based scenario index into manual-reruns.json
#   [assistantFile] file with the pasted app reply; omit to (re)print the
#                   pending user message
```

## `complete-run.mjs` — judge transcripts, merge into the run

For each collected transcript, calls `kora.runTest` with the full conversation
as `startMessages` (the turn loop is skipped → straight to the judges) and
overwrites the matching `RUN_DIR/.kora-run-tmp/<hash>.json` (matched by
`scenario.seed.id`). Re-run `kora run -o RUN_DIR/results.json` afterwards to
cache-aggregate every result into the final `results.json` + `.zip`.

```sh
RUN_DIR=data/<run> [JUDGE=gpt-5.2:medium:limited] \
  node --env-file=.env scripts/complete-run.mjs
```
