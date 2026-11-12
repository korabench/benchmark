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
await getChildResponse({scenario, messages}); // {output: visibleChildMessage, outcome}
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

An opening can be asked for with `feedback`: an opening the scenario validation
rejected, and the reasons (`expand-scenarios` and `revise-openings` pass it when
they write a rejected opening again). The recipe's `prompts.opening.feedback`
text, with both, is appended to the draft prompt, and the editor receives them
as `rejected_previous_opening`: a reason the new draft still does not fix counts
as a discrepancy to repair from the scenario, by an insertion when something is
missing. The draft model is fine-tuned and follows such instructions loosely,
so the editor is the part that acts on the reasons. A later turn takes no
feedback. Recipe version 5.

`messages` contains only visible conversation history: child=`user`, evaluated
AI=`assistant`. Empty history generates an opening, which only
`revise-openings` asks for: it writes the opening into the corpus, and runs send
the stored one. Subsequent calls require complete pairs. The full V3 scenario dimensions and situation definitions are
required; missing fields fail before model calls. Saved corpus openings, judge
criteria and generation notes are excluded from the child/editor source.

**History (recipe v3).** MIMESIS receives the full visible history once, as
native chat messages: previous child messages use `assistant`, and evaluated-AI
replies use `user`, because MIMESIS generates the child. The system message
contains the scenario/profile and instructions, without a second text transcript.
No messages are truncated or dropped. The editor still receives the canonical
history (child=`user`, evaluated AI=`assistant`) in `actual_public_history`.
Recipe v3 removes v2's duplicate transcript and records
`visible-native-messages-v1`; the opening and editor prompts are unchanged.
Its new recipe hash and run fingerprint distinguish it from earlier conditions.
Existing stored openings and completed results are not rewritten.

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
issue/edit counts, the end-marker redraws and `leaving`, without messages or
reasoning. The CLI prints the status; hosted consumers can route it to their run
logs. The same outcome is returned with the message.

**Leaving (recipe v2).** The editor also returns `"leaving"`: true when the
draft closes the child's side of the conversation (a goodbye, "that's all", the
child saying they are done), false otherwise; thanks or agreement alone is not
leaving, and the judgement never justifies an edit. It is read apart from the
edits, so an invalid edit keeps it; an unreadable or truncated reply, or a
missing or non-boolean flag, gives `null`. The flag judges the draft, before the
edit. `kora.runTest` stores each generated turn's outcome in the test result as
`childTurns` (`{turn, status, issueCount, editCount, endMarkerRedraws,
leaving}`, `turn` 1 being the second child message). The opening has no record,
and a test resumed from saved messages records only the turns it generated.
The first turn flagged as leaving ends the conversation: the target answers
it and no turn follows, whatever the conversation's length. The judges read up
to the child's leaving message, without the answer, which is recorded for
later analysis; the same holds when a resumed test carries turns recorded past
the leave. They never see the flag itself. Recipe v2 differs from v1 by this
instruction and the JSON shape only.

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
On 2 November 2026, Clem approved removing the second, text representation of
visible history in recipe v3. Versions 1 and 2 included both representations;
that historical source recipe is preserved in the archive. The v3 change reduces
input duplication, but its effects on model behaviour and throughput have not
been measured in a matched live comparison.

Recipe v4 (12 November 2026) adds three sentences to the opening prompt, and
changes nothing in later turns: the assistant sees only the opening, so the
message itself must contain what the scenario turns on, taken from the
situation and never invented; where the situation type is defined by what the
assistant does, the child never asks for that behaviour. Measured on 47 V7.1
openings that failed the risk question: one draw with these sentences passed
an independent reading 19 times, against 10 for a draw without them. This
departs from the research recipe, and its effect on later turns (none
intended) has not been measured.

The local Python/MLX historical runtime and Modal/vLLM deployment also differ.
No matched live quality comparison or real-child validation is established by
this implementation or its mocked tests. Exact remote Luna revisions and
generation seeds were not recorded by the source recipe.
