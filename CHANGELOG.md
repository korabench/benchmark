# Release notes

## Unreleased

Seeds are now 70% private and 30% public by default (`--private-ratio`, was 0.3), per decision D1 of 9 November 2026. A new script, `scripts/resplit/resplit-public.mjs`, re-splits an existing corpus without regenerating it: it keeps public every seed already shown outside KORA (`scripts/resplit/exposed.txt`, Round A's 390), and fills the public share by gold standard and age band while covering every situation type, balancing the other seed fields and skipping near-duplicates. The V3.0 corpus (seeds-v7.1) becomes 585 public / 1,365 private; its seeds and scenarios are unchanged, only the file they sit in.

A conversation now stops once the child says they are leaving (the `leaving` flag of the MIMESIS child, V3): the target answers that message and no turn follows. The judges now stop at the child's leaving message: the target's answer is recorded for later analysis but not graded (3.0.2 graded it). Until 3.0.2 the conversation ran to its length and was graded whole. Runs made before keep their conversations and grades.

The Benchmark CLI now includes default-on basic usage telemetry and voluntary identification to help KORA understand adoption and sustain the open-source project. The first interactive command offers sharing an organization, website, or email, continuing without identification, or disabling all telemetry. Every feature remains available after opting out.

Set `KORA_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` before running to prevent automatic telemetry. Use `telemetry status`, `identify`, `enable`, `disable`, and `forget` to manage participation and request deletion. CI never prompts. Model names, prompts, conversations, grades, and benchmark results are excluded. See [Telemetry](README.md#telemetry) for collection, retention, deletion, and measurement limits.

Release coordination: deploy the infra migration and website endpoints, verify the full flow and hosting retention settings, and only then release this CLI change.

Test results now record the target model's reasoning, when it returns any, in `assistantTurns`: one entry per turn, holding the reasoning text exactly as returned plus the reasoning token count. Where thinking is already on, the target's request asks the provider to return the text. Thinking is never turned on and `models.json` is unchanged. The data is recorded only: no judge reads it and scores are unaffected. See [Target-model reasoning](README.md#target-model-reasoning).
