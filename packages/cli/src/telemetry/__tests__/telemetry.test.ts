import {execFile} from "node:child_process";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import * as v from "valibot";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {workSummary} from "../../commands/shared/executionSummary.js";
import {eventSchema, identifySchema} from "../contract.js";
import {buildEvent, eventMetadata} from "../events.js";
import {executeCommand} from "../executeCommand.js";
import {TelemetryManagement} from "../management.js";
import {chooseParticipation, prepareTelemetry} from "../onboarding.js";
import {
  defaultSettings,
  environmentOverrides,
  SettingsStore,
  withCredentials,
} from "../settings.js";
import {TelemetryTransport} from "../transport.js";

let directory: string;
let store: SettingsStore;
const exec = promisify(execFile);
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "kora-telemetry-"));
  store = new SettingsStore(path.join(directory, "telemetry.json"));
  vi.stubEnv("KORA_TELEMETRY_DISABLED", "0");
  vi.stubEnv("DO_NOT_TRACK", "0");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
});

it("keeps v1 fixtures and privacy allowlists strict", async () => {
  const fixtures = JSON.parse(
    await readFile(new URL("../fixtures.v1.json", import.meta.url), "utf8")
  );
  expect(v.safeParse(eventSchema, fixtures.started).success).toBe(true);
  expect(v.safeParse(eventSchema, fixtures.finished).success).toBe(true);
  expect(v.safeParse(identifySchema, fixtures.identify).success).toBe(true);
  for (const key of [
    "model",
    "prompt",
    "args",
    "path",
    "error",
    "email",
    "secret",
  ])
    expect(
      v.safeParse(eventSchema, {...fixtures.started, [key]: "private"}).success
    ).toBe(false);
  expect(
    v.safeParse(eventSchema, {
      ...fixtures.finished,
      work: {...fixtures.finished.work, completed: 101},
    }).success
  ).toBe(false);
});
it("treats unknown nonempty opt-outs conservatively", () => {
  for (const value of ["1", "true", "yes", "on", "TRUE", "invalid"])
    expect(environmentOverrides({DO_NOT_TRACK: value})).toEqual([
      "DO_NOT_TRACK",
    ]);
  for (const value of ["0", "false", "no", "off", ""])
    expect(environmentOverrides({DO_NOT_TRACK: value})).toEqual([]);
});
it("persists one identity across concurrent initializations with restrictive permissions", async () => {
  const results = await Promise.all(
    Array.from({length: 8}, () => store.update(withCredentials))
  );
  expect(
    new Set(results.map(value => value.credentials?.installationId)).size
  ).toBe(1);
  expect((await stat(store.file)).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
});
it("disabled reporting does not create settings, prompt, or contact the collector", async () => {
  vi.stubEnv("DO_NOT_TRACK", "yes");
  const fetcher = vi.fn();
  const prompt = vi.fn();
  expect(
    await prepareTelemetry(
      store,
      new TelemetryTransport(undefined, fetcher),
      true,
      prompt
    )
  ).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
  await expect(stat(store.file)).rejects.toThrow();
});
it("all three participation choices are explicit and remembered", async () => {
  const ask = (answers: string[]) => vi.fn(async () => answers.shift()!);
  const disabled = await chooseParticipation(
    defaultSettings(),
    ask(["3"]),
    () => {}
  );
  expect(disabled).toMatchObject({enabled: false, onboarded: true});
  expect(disabled.credentials).toBeUndefined();
  const basic = await chooseParticipation(
    defaultSettings(),
    ask(["2"]),
    () => {}
  );
  expect(basic.enabled).toBe(true);
  expect(basic.identity).toBeUndefined();
  expect(basic.credentials).toBeDefined();
  const shared = await chooseParticipation(
    defaultSettings(),
    ask(["1", "1", "Example Research"]),
    () => {}
  );
  expect(shared.identity).toEqual({organization: "Example Research"});
  await store.update(() => shared);
  const prompt = vi.fn();
  await prepareTelemetry(
    store,
    new TelemetryTransport(undefined, vi.fn()),
    true,
    prompt
  );
  expect(prompt).not.toHaveBeenCalled();
});
it("noninteractive onboarding never prompts and remains available later in a terminal", async () => {
  const prompt = vi.fn();
  await prepareTelemetry(
    store,
    new TelemetryTransport(undefined, vi.fn()),
    false,
    prompt
  );
  expect(prompt).not.toHaveBeenCalled();
  expect(await store.read()).toMatchObject({
    enabled: true,
    onboarded: false,
    noticeShown: true,
  });
});
it("corrupt settings fail closed without replacing the installation", async () => {
  await writeFile(store.file, "broken");
  const fetcher = vi.fn();
  expect(
    await prepareTelemetry(
      store,
      new TelemetryTransport(undefined, fetcher),
      false
    )
  ).toBeUndefined();
  expect(await readFile(store.file, "utf8")).toBe("broken");
  expect(fetcher).not.toHaveBeenCalled();
});
it("disable and identify while disabled are local only, status never reveals the secret", async () => {
  const settings = await store.update(withCredentials);
  const fetcher = vi.fn();
  const write = vi.fn();
  const manager = new TelemetryManagement(
    store,
    new TelemetryTransport(undefined, fetcher),
    write
  );
  await manager.disable();
  await manager.identify({email: "tester@example.org"});
  await manager.status();
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.stringify(write.mock.calls)).not.toContain(
    settings.credentials!.secret
  );
  expect(await store.read()).toMatchObject({
    identity: {email: "tester@example.org"},
    enabled: false,
  });
});
it("failed deletion stays disabled and retryable even under an environment opt-out", async () => {
  const before = await store.update(withCredentials);
  vi.stubEnv("DO_NOT_TRACK", "1");
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Response(null, {status: 204}));
  const manager = new TelemetryManagement(
    store,
    new TelemetryTransport(undefined, fetcher),
    () => {}
  );
  await expect(manager.forget()).rejects.toThrow("Deletion not confirmed");
  expect(await store.read()).toMatchObject({
    enabled: false,
    pendingDeletion: true,
    credentials: before.credentials,
  });
  await expect(manager.enable()).rejects.toThrow("Deletion not confirmed");
  await manager.forget();
  expect(await store.read()).toEqual({
    schemaVersion: 1,
    enabled: false,
    onboarded: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("distinguishes cached work, new successes, partial failure and all-failed work", () => {
  expect(workSummary("test", 100, 95, 5, 10)).toEqual({
    outcome: "partial",
    work: {unit: "test", planned: 100, completed: 85, failed: 5, reused: 10},
  });
  expect(workSummary("seed", 3, 0, 3, 0).outcome).toBe("failed");
  expect(workSummary("test", 3, 3, 0, 3).work?.completed).toBe(0);
  const metadata = eventMetadata(
    "88b7af65-ccdd-4a74-97b2-74f233d316b0",
    "run",
    "1.0.0",
    false
  );
  expect(buildEvent(metadata).invocationId).toBe(
    buildEvent(metadata, workSummary("test", 3, 3, 0, 3), 1).invocationId
  );
});
it("preserves command failures and output when collection fails", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  const error = new Error("original command failure");
  const output = vi.fn();
  await expect(
    executeCommand(
      "stats",
      () => {
        output("original output");
        throw error;
      },
      store,
      new TelemetryTransport(undefined, fetcher)
    )
  ).rejects.toBe(error);
  expect(output).toHaveBeenCalledWith("original output");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("sends both phases to a real local HTTP collector", async () => {
  const events: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    events.push(JSON.parse(body));
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as {port: number};
    await executeCommand(
      "run",
      () => workSummary("test", 10, 8, 2, 3),
      store,
      new TelemetryTransport(`http://127.0.0.1:${address.port}`)
    );
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "command_finished",
          outcome: "partial",
          work: {unit: "test", planned: 10, completed: 5, failed: 2, reused: 3},
        }),
      ])
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
it("cancels a stalled collector within the shutdown bound", async () => {
  const fetcher: typeof fetch = vi.fn(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      )
  );
  const started = performance.now();
  await executeCommand(
    "stats",
    () => {},
    store,
    new TelemetryTransport(undefined, fetcher)
  );
  expect(performance.now() - started).toBeLessThan(1600);
});
describe("CLI without benchmark configuration", () => {
  for (const args of [
    ["--help"],
    ["telemetry", "--help"],
    ["telemetry", "status"],
  ])
    it(args.join(" "), async () => {
      const cli = path.resolve("packages/cli/build/src/cli.js");
      const result = await exec(process.execPath, [cli, ...args], {
        cwd: directory,
        env: {...process.env, KORA_TELEMETRY_DISABLED: "1"},
      });
      expect(result.stderr).not.toContain("models.json");
      expect(result.stdout).not.toContain("preview");
    });
});
