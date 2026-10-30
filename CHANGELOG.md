# Release notes

## Unreleased

The Benchmark CLI now includes default-on basic usage telemetry and voluntary identification to help KORA understand adoption and sustain the open-source project. The first interactive command offers sharing an organization, website, or email, continuing without identification, or disabling all telemetry. Every feature remains available after opting out.

Set `KORA_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` before running to prevent automatic telemetry. Use `telemetry status`, `identify`, `enable`, `disable`, and `forget` to manage participation and request deletion. CI never prompts. Model names, prompts, conversations, grades, and benchmark results are excluded. See [Telemetry](README.md#telemetry) for collection, retention, deletion, and measurement limits.

Release coordination: deploy the infra migration and website endpoints, verify the full flow and hosting retention settings, and only then release this CLI change.

Test results now record the target model's reasoning, when it returns any, in `assistantTurns`: one entry per turn, holding the reasoning text exactly as returned plus the reasoning token count. Where thinking is already on, the target's request asks the provider to return the text. Thinking is never turned on and `models.json` is unchanged. The data is recorded only: no judge reads it and scores are unaffected. See [Target-model reasoning](README.md#target-model-reasoning).
