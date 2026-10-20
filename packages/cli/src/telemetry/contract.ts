// Telemetry v1. Keep this contract and fixtures identical in Benchmark and infra.
import * as v from "valibot";

export const commands = [
  "generate-seeds",
  "expand-scenarios",
  "run",
  "reassess",
  "continue",
  "seeds-report",
  "compare-assessments",
  "stats",
  "validate",
  "profile",
] as const;
export const uuid = v.pipe(v.string(), v.uuid());
const count = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(Number.MAX_SAFE_INTEGER)
);
const text = (max: number) =>
  v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));
export const identitySchema = v.pipe(
  v.strictObject({
    organization: v.optional(text(200)),
    website: v.optional(
      v.pipe(
        text(2048),
        v.url(),
        v.check(value => {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        })
      )
    ),
    email: v.optional(v.pipe(text(254), v.email())),
  }),
  v.check(value => Object.values(value).some(value => value !== undefined))
);
export type Identity = v.InferOutput<typeof identitySchema>;
export const identifySchema = v.strictObject({
  schemaVersion: v.literal(1),
  installationId: uuid,
  identity: identitySchema,
});
const workSchema = v.strictObject({
  unit: v.picklist(["seed", "test"]),
  planned: v.optional(count),
  completed: v.optional(count),
  failed: v.optional(count),
});
const metadata = {
  schemaVersion: v.literal(1),
  eventId: uuid,
  installationId: uuid,
  invocationId: uuid,
  command: v.picklist(commands),
  cliVersion: v.pipe(
    text(50),
    v.regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/)
  ),
  occurredAt: v.pipe(v.string(), v.isoTimestamp(), v.endsWith("Z")),
  os: v.picklist(["linux", "darwin", "win32", "other"]),
  ci: v.boolean(),
};
export const eventSchema = v.pipe(
  v.variant("event", [
    v.strictObject({...metadata, event: v.literal("command_started")}),
    v.strictObject({
      ...metadata,
      event: v.literal("command_finished"),
      durationSeconds: count,
      outcome: v.picklist(["completed", "partial", "failed", "interrupted"]),
      work: v.optional(workSchema),
    }),
  ]),
  v.check(event => {
    if (event.event !== "command_finished" || !event.work) return true;
    const seed = ["generate-seeds", "expand-scenarios"].includes(event.command);
    const test = ["run", "reassess", "continue"].includes(event.command);
    if ((!seed && !test) || event.work.unit !== (seed ? "seed" : "test"))
      return false;
    const {planned, completed, failed} = event.work;
    return planned === undefined || (completed ?? 0) + (failed ?? 0) <= planned;
  })
);
export type TelemetryEvent = v.InferOutput<typeof eventSchema>;
export type TrackedCommand = TelemetryEvent["command"];
export type Work = v.InferOutput<typeof workSchema>;
