# Release notes

## Unreleased

The MIMESIS child now takes the validation's feedback when it writes a rejected opening again, as the plain user model does: the rejected opening and the reasons are appended to the draft prompt and given to the editor, which repairs from the scenario a reason the new draft still does not fix. Until now a rejected opening was only drawn again with the same request. The recipe moves to version 5 (new `prompts.opening.feedback`, one paragraph in the editor prompt); later turns are unchanged, but the recipe hash changes.

The scenario validation gains `firstMessageTestsRisk`, asked in a call of its own: does the first user message, read on its own, give the assistant a real occasion to show the risk under test? The validator sees the risk, the situation type, the signal type and the message, never the narrative. In `expand-scenarios`, a scenario rejected on it is expanded again from the same seed with the reason, and the expansion prompt now asks that what the child writes contain the element the risk turns on, without asking for the assistant's behavior. In `revise-openings` and `validate-openings` it applies like the other first-message questions. It comes from the expert plausibility review of V7.1: 27 of 390 scenarios were confirmed as not testing their risk, and the existing questions rejected 3 of them. Prompt templates move to version 4.

The MIMESIS child recipe moves to version 4: its opening prompt says the assistant sees only the opening, so the message must contain what the scenario turns on. Later turns are unchanged, but the recipe hash changes, and runs stamped with it are not under the same child as earlier ones.

`revise-openings` now also writes an opening again when the checklist or a scenario question rejects it (the scenario passed them at expansion, so the new opening is what changed), and takes `--max-attempts` (default 2).

`revise-openings --again` writes again openings the same child already wrote. Without it the command refuses such a corpus. It is for openings written before `revise-openings` validated them: the V7.1 openings were written by the MIMESIS child with no validation, and some would not have passed expansion's.

Seeds are now 70% private and 30% public by default (`--private-ratio`, was 0.3), per decision D1 of 9 November 2026. A new script, `scripts/resplit/resplit-public.mjs`, re-splits an existing corpus without regenerating it: it keeps public every seed already shown outside KORA (`scripts/resplit/exposed.txt`, Round A's 390), and fills the public share by gold standard and age band while covering every situation type, balancing the other seed fields and skipping near-duplicates. The V3.0 corpus (seeds-v7.1) becomes 585 public / 1,365 private; its seeds and scenarios are unchanged, only the file they sit in.

A conversation now stops once the child says they are leaving (the `leaving` flag of the MIMESIS child, V3): the target answers that message and no turn follows. The judges now stop at the child's leaving message: the target's answer is recorded for later analysis but not graded (3.0.2 graded it). Until 3.0.2 the conversation ran to its length and was graded whole. Runs made before keep their conversations and grades.

The Benchmark CLI now includes default-on basic usage telemetry and voluntary identification to help KORA understand adoption and sustain the open-source project. The first interactive command offers sharing an organization, website, or email, continuing without identification, or disabling all telemetry. Every feature remains available after opting out.

Set `KORA_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` before running to prevent automatic telemetry. Use `telemetry status`, `identify`, `enable`, `disable`, and `forget` to manage participation and request deletion. CI never prompts. Model names, prompts, conversations, grades, and benchmark results are excluded. See [Telemetry](README.md#telemetry) for collection, retention, deletion, and measurement limits.

Release coordination: deploy the infra migration and website endpoints, verify the full flow and hosting retention settings, and only then release this CLI change.

Test results now record the target model's reasoning, when it returns any, in `assistantTurns`: one entry per turn, holding the reasoning text exactly as returned plus the reasoning token count. Where thinking is already on, the target's request asks the provider to return the text. Thinking is never turned on and `models.json` is unchanged. The data is recorded only: no judge reads it and scores are unaffected. See [Target-model reasoning](README.md#target-model-reasoning).
