import type {ExecutionSummary} from "../commands/shared/executionSummary.js";
import {readPackageVersion} from "../shared/packageVersion.js";
import type {TrackedCommand} from "./contract.js";
import {buildEvent, eventMetadata} from "./events.js";
import {isCi, OnboardingCancelled, prepareTelemetry} from "./onboarding.js";
import {reportingEnabled, SettingsStore} from "./settings.js";
import {TelemetryTransport} from "./transport.js";

export async function executeCommand(
  command: TrackedCommand,
  action: () => Promise<ExecutionSummary | void> | ExecutionSummary | void,
  store = new SettingsStore(),
  transport = new TelemetryTransport()
): Promise<void> {
  let settings;
  try {
    settings = await prepareTelemetry(store, transport);
  } catch (error) {
    if (!(error instanceof OnboardingCancelled)) throw error;
    process.exitCode = 130;
    return;
  }
  const credentials = settings?.credentials;
  const metadata = credentials
    ? eventMetadata(
        credentials.installationId,
        command,
        readPackageVersion(),
        isCi()
      )
    : undefined;
  const started = performance.now();
  const sends: Promise<void>[] = [];
  let finished = false;
  let closed = false;
  const send = (summary?: ExecutionSummary) => {
    if (!metadata || !credentials) return;
    sends.push(
      (async () => {
        try {
          const current = await store.read();
          if (
            closed ||
            !reportingEnabled(current) ||
            current.credentials?.secret !== credentials.secret
          )
            return;
          await transport.send(
            "events",
            credentials,
            buildEvent(
              metadata,
              summary,
              Math.max(0, Math.round((performance.now() - started) / 1000))
            )
          );
        } catch {
          /* Telemetry must never affect command behavior. */
        }
      })()
    );
  };
  const finish = (summary: ExecutionSummary) => {
    if (!finished) {
      finished = true;
      send(summary);
    }
  };
  let shuttingDown = false;
  const interrupted = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    finish({outcome: "interrupted"});
    void flush().finally(() => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.kill(process.pid, signal);
    });
  };
  const onSigint = () => interrupted("SIGINT");
  const onSigterm = () => interrupted("SIGTERM");
  const flush = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(sends),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
    clearTimeout(timer);
    closed = true;
    transport.cancel();
  };
  if (credentials) {
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  }
  send();
  try {
    const summary = await action();
    finish(
      summary ?? {
        outcome:
          process.exitCode && process.exitCode !== "0" ? "failed" : "completed",
      }
    );
  } catch (error) {
    finish({outcome: "failed"});
    throw error;
  } finally {
    await flush();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

export function trackedAction<T extends unknown[]>(
  command: TrackedCommand,
  setup: () => void,
  action: (
    ...args: T
  ) => Promise<ExecutionSummary | void> | ExecutionSummary | void
) {
  return (...args: T) =>
    executeCommand(command, () => {
      setup();
      return action(...args);
    });
}
