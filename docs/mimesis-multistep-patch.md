# Bench V3 — Experimental

`profiles/bench-v3-experimental.json` is an optional **Bench V3 — Experimental** profile. It leaves
`profiles/kora.json` as the default. Every child turn in each test conversation
after the opening uses MIMESIS-9B followed by one GPT-6-Luna targeted-edit pass.
The opening is the scenario's stored `firstUserMessage`, written once into the
corpus with the same recipe by `yarn kora revise-openings` (see the README,
"Switching the child model"), so every target answers the same first message. Safety judges and
behaviour judges match the current V3 profile.

```sh
export MIMESIS_BASE_URL='https://YOUR-ENDPOINT/v1'
export MIMESIS_API_KEY='<proxy-token-id>.<proxy-token-secret>'
yarn kora --profile ./profiles/bench-v3-experimental.json run <target>
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
policies remain transport concerns. The one content redraw is the recipe's own:
a draft carrying a conversation-end marker (`[end]`, `[end of conversation]`,
`[end chat]`…), a token from MIMESIS's training transcripts that no child types,
is drawn again with the same request, up to three draws in all. A marker the
third draw still carries is cut out, and a draft that is nothing else fails the
turn. An edit that would add one is invalid, and the draft is kept.

`messages` contains only visible conversation history: child=`user`, evaluated
AI=`assistant`. Empty history generates an opening, which only
`revise-openings` asks for: it writes the opening into the corpus, and runs send
the stored one. Subsequent calls require complete pairs. The full V3 scenario dimensions and situation definitions are
required; missing fields fail before model calls. Saved corpus openings, judge
criteria and generation notes are excluded from the child/editor source.

`TestContext.getChildResponse` is optional. `kora.runTest` and continuation use it
for every turn after the opening when provided; the opening is always the
scenario's stored `firstUserMessage`. Contexts without it keep the ordinary
child prompt path. Completed visible pairs suffice to resume this recipe. No private
reasoning, new table or database dependency is introduced.

The edit pass validates issues/source references and exact non-overlapping
replacement spans. It preserves all unaffected draft text. Invalid JSON,
invalid/truncated edits or empty edited output retain the draft and report
`invalid_correction_retained_draft` through the text-free outcome hook. Draft
failure and editor transport failure fail the turn. The hook reports status and
issue/edit counts and the end-marker redraws, without messages or reasoning. The CLI prints the status;
hosted consumers can route it to their run logs.

`MimesisPatch.fingerprint(benchmarkFingerprint)` includes exact recipe prompts,
both model configurations, the history policy, the opening policy (`corpus`:
runs that sampled the opening per test carry a different hash) and the
end-marker policy (pattern and draws: runs before it carry a different hash).
`MimesisPatch.recipeRef()` names the recipe alone, by content; it is what a
scenario revision records. Both CLI and hosted consumers
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
