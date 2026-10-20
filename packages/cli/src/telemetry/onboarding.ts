import {createInterface} from "node:readline/promises";
import * as v from "valibot";
import {identitySchema, type Identity} from "./contract.js";
import {
  environmentOverrides,
  reportingEnabled,
  SettingsStore,
  withCredentials,
  type Settings,
} from "./settings.js";
import {TelemetryTransport} from "./transport.js";

export type Ask = (question: string) => Promise<string>;
export class OnboardingCancelled extends Error {
  constructor() {
    super("KORA command cancelled before sending telemetry.");
  }
}
export const isCi = (env: NodeJS.ProcessEnv = process.env) =>
  [
    "CI",
    "CONTINUOUS_INTEGRATION",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BUILD_NUMBER",
    "JENKINS_URL",
    "TF_BUILD",
  ].some(key => {
    const value = env[key]?.trim().toLowerCase();
    return !!value && !["0", "false", "no", "off"].includes(value);
  });
export const isInteractive = () =>
  !!process.stdin.isTTY && !!process.stderr.isTTY && !isCi();

export async function withPrompt<T>(run: (ask: Ask) => Promise<T>): Promise<T> {
  const reader = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const controller = new AbortController();
  reader.on("close", () => controller.abort());
  reader.on("SIGINT", () => reader.close());
  try {
    return await run(question =>
      reader.question(question, {signal: controller.signal})
    );
  } catch (error) {
    if (controller.signal.aborted) throw new OnboardingCancelled();
    throw error;
  } finally {
    reader.close();
  }
}

export async function askIdentity(ask: Ask): Promise<Identity> {
  const type =
    (
      await ask(
        "Share: 1) Organization  2) Website  3) Email\nYour choice [1]: "
      )
    ).trim() || "1";
  const key = ({"1": "organization", "2": "website", "3": "email"} as const)[
    type as "1" | "2" | "3"
  ];
  if (!key)
    throw new Error("Choose organization, website, or email (1, 2, or 3).");
  const value = await ask(
    `${key === "website" ? "Website (https://…)" : key === "email" ? "Email" : "Organization"}: `
  );
  const parsed = v.safeParse(identitySchema, {[key]: value});
  if (!parsed.success)
    throw new Error(
      "Please supply a valid, nonempty identifier (websites need http:// or https://)."
    );
  return parsed.output;
}

export async function chooseParticipation(
  settings: Settings,
  ask: Ask,
  write = console.error
): Promise<Settings> {
  write(
    "\nBecause KORA is open source, our team may never know that our work is useful to you. Sharing your organization, website, or email helps us understand who we’re reaching, prioritize improvements, and demonstrate why maintaining an independent, open-source benchmark matters.\n"
  );
  write(
    "Your identity stays private within KORA and links to retained activity from this installation. It does not subscribe you to a mailing list. All features remain available whichever choice you make.\nBasic telemetry records commands, timing, completion and work counts, CLI version, OS family, CI status, and a random installation ID. It excludes model names and benchmark content/results. Details: https://github.com/korabench/benchmark#telemetry\n"
  );
  write(
    "1) Share an organization, website, or email.\n2) Continue without identifying myself — basic telemetry stays on.\n3) Disable all telemetry."
  );
  const choice = (await ask("Your choice [2]: ")).trim() || "2";
  if (choice === "3") return {...settings, enabled: false, onboarded: true};
  if (choice === "2") return withCredentials({...settings, onboarded: true});
  if (choice === "1")
    return withCredentials({
      ...settings,
      onboarded: true,
      identity: await askIdentity(ask),
    });
  throw new Error("Choose 1, 2, or 3; no telemetry has been sent.");
}

export async function prepareTelemetry(
  store: SettingsStore,
  transport: TelemetryTransport,
  interactive = isInteractive(),
  prompt = withPrompt
): Promise<Settings | undefined> {
  if (environmentOverrides().length) return undefined;
  let shared = false;
  let choseDisable = false;
  try {
    const settings = await store.update(async current => {
      if (!reportingEnabled(current)) return current;
      if (interactive && !current.onboarded) {
        const next = await prompt(ask => chooseParticipation(current, ask));
        shared = !!next.identity;
        choseDisable = !next.enabled;
        return next;
      }
      if (!current.noticeShown && !current.onboarded) {
        console.error(
          "KORA basic telemetry is on; no identity requested without a terminal. Disable: KORA_TELEMETRY_DISABLED=1 or kora telemetry disable. Details: https://github.com/korabench/benchmark#telemetry"
        );
      }
      return withCredentials({...current, noticeShown: true});
    });
    if (!reportingEnabled(settings) || !settings.credentials) {
      if (choseDisable)
        console.error("All telemetry is disabled. Thank you for trying KORA.");
      return undefined;
    }
    if (shared) {
      // Complete the first-run confirmation before benchmark progress starts.
      const sent = await transport.send("identify", settings.credentials, {
        schemaVersion: 1,
        installationId: settings.credentials.installationId,
        identity: settings.identity,
      });
      console.error(
        sent
          ? "Thank you — your identifier was successfully shared with KORA. It really helps us understand our impact."
          : "Your identifier is saved locally; sharing was not confirmed. Retry with kora telemetry identify."
      );
    }
    return settings;
  } catch (error) {
    if (error instanceof OnboardingCancelled) throw error;
    console.error(
      "KORA telemetry skipped: settings or participation could not be saved. Your benchmark command will continue."
    );
    return undefined;
  }
}
