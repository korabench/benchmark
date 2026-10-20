import {randomUUID} from "node:crypto";
import * as v from "valibot";
import type {ExecutionSummary} from "../commands/shared/executionSummary.js";
import {
  eventSchema,
  type TelemetryEvent,
  type TrackedCommand,
} from "./contract.js";

export function eventMetadata(
  installationId: string,
  command: TrackedCommand,
  cliVersion: string,
  ci: boolean,
  platform: string = process.platform
) {
  return {
    schemaVersion: 1 as const,
    installationId,
    invocationId: randomUUID(),
    command,
    cliVersion,
    ci,
    os: ["linux", "darwin", "win32"].includes(platform)
      ? (platform as "linux" | "darwin" | "win32")
      : ("other" as const),
  };
}
export function buildEvent(
  metadata: ReturnType<typeof eventMetadata>,
  summary?: ExecutionSummary,
  durationSeconds = 0
): TelemetryEvent {
  // Strict validation is a final privacy boundary; never spread command options/errors here.
  return v.parse(eventSchema, {
    ...metadata,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    ...(summary
      ? {
          event: "command_finished",
          outcome: summary.outcome,
          durationSeconds,
          ...(summary.work ? {work: summary.work} : {}),
        }
      : {event: "command_started"}),
  });
}
