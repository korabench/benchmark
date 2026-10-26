# MIMESIS multistep patch

`profiles/mimesis-multistep-patch.json` is an optional Bench V3 profile. It leaves
`profiles/kora.json` as the default. Every child turn, including the opening,
uses MIMESIS-9B followed by one GPT-6-Luna targeted-edit pass. Safety judges and
behaviour judges match the current V3 profile.

```sh
export MIMESIS_BASE_URL='https://YOUR-ENDPOINT/v1'
export MIMESIS_API_KEY='<proxy-token-id>.<proxy-token-secret>'
yarn kora --profile ./profiles/mimesis-multistep-patch.json run <target>
```

The Modal endpoint must support 4,096 output tokens. The editor and the other
remote models use the CLI's existing gateway credentials. A normal child turn
makes two model calls. No model call occurs merely by selecting/loading a profile.

## Shared library contract

`MimesisPatch.create({draft, editor, onOutcome?})` returns a child-response function:

```ts
const getChildResponse = MimesisPatch.create({draft, editor, onOutcome});
await getChildResponse({scenario, messages}); // {output: visibleChildMessage}
```

`draft` and `editor` accept the existing `ModelRequest` and return
`{output: string, truncated?: boolean}`. The recipe supplies token limits of
4,096 and 8,192 respectively. The transport configures MIMESIS at temperature 1,
top-p 0.95, and GPT-6-Luna at low reasoning effort. Neither transport may retry
content to get a more desirable answer. Explicit startup/capacity/network retry
policies remain transport concerns.

`messages` contains only visible conversation history: child=`user`, evaluated
AI=`assistant`. Empty history generates the opening; subsequent calls require
complete pairs. The full V3 scenario dimensions and situation definitions are
required; missing fields fail before model calls. Saved corpus openings, judge
criteria and generation notes are excluded from the child/editor source.

`TestContext.getChildResponse` is optional. `kora.runTest` and continuation use it
when provided; existing contexts keep their saved opening and ordinary child
prompt path. Completed visible pairs suffice to resume this recipe. No private
reasoning, new table or database dependency is introduced.

The edit pass validates issues/source references and exact non-overlapping
replacement spans. It preserves all unaffected draft text. Invalid JSON,
invalid/truncated edits or empty edited output retain the draft and report
`invalid_correction_retained_draft` through the text-free outcome hook. Draft
failure and editor transport failure fail the turn. The hook reports status and
issue/edit counts, without messages or reasoning. The CLI prints the status;
hosted consumers can route it to their run logs.

`MimesisPatch.fingerprint(benchmarkFingerprint)` includes exact recipe prompts,
both model configurations and the history policy. Both CLI and hosted consumers
must use it when stamping runs with this recipe.

## Source and limits

Prompts and edit rules come from the [versioned research recipe](https://github.com/korabench/research/tree/79bb453466314268c19b793880383271c7e983cb/resources/recipes/e26-promising-child).
The port was approved on 26 October 2026 with one intentional history change:
only final visible messages are replayed; historical private reasoning is
discarded. It is therefore an adapted condition, not an exact E26 replay.

The local Python/MLX historical runtime and Modal/vLLM deployment also differ.
No matched live quality comparison or real-child validation is established by
this implementation or its mocked tests. Exact remote Luna revisions and
generation seeds were not recorded by the source recipe.
