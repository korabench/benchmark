import {Command} from "@commander-js/extra-typings";
import * as v from "valibot";
import {identitySchema, type Identity} from "./contract.js";
import {askIdentity, isInteractive, withPrompt} from "./onboarding.js";
import {
  environmentOverrides,
  reportingEnabled,
  SettingsStore,
  withCredentials,
} from "./settings.js";
import {TelemetryTransport} from "./transport.js";

export class TelemetryManagement {
  constructor(
    private readonly store = new SettingsStore(),
    private readonly transport = new TelemetryTransport(),
    private readonly write = console.log
  ) {}
  async status() {
    const settings = await this.store.read();
    this.write(
      `Telemetry: ${reportingEnabled(settings) ? "enabled" : "disabled"}\nEnvironment opt-outs: ${environmentOverrides().join(", ") || "none"}\nIdentity: ${settings.identity ? JSON.stringify(settings.identity) : "not supplied"}\nInstallation ID: ${settings.credentials?.installationId ?? "not created"}\nSettings: ${this.store.file}${settings.pendingDeletion ? "\nDeletion not confirmed; retry kora telemetry forget." : ""}`
    );
  }
  async enable() {
    await this.store.update(settings => {
      if (settings.pendingDeletion)
        throw new Error(
          "Deletion not confirmed. Retry kora telemetry forget before enabling telemetry."
        );
      return {...settings, enabled: true, onboarded: true};
    });
    this.write(
      environmentOverrides().length
        ? "Telemetry is enabled in settings, but the environment opt-out still disables reporting."
        : "Telemetry enabled for future commands."
    );
  }
  async disable() {
    await this.store.update(settings => ({
      ...settings,
      enabled: false,
      onboarded: true,
    }));
    this.write(
      "All telemetry disabled. No request was sent. Use kora telemetry forget to delete previously shared data."
    );
  }
  async identify(identity: Identity) {
    const parsed = v.safeParse(identitySchema, identity);
    if (!parsed.success)
      throw new Error(
        "Provide at least one valid organization, HTTP(S) website, or email."
      );
    const settings = await this.store.update(current => {
      const next = {...current, identity: parsed.output, onboarded: true};
      return reportingEnabled(next) ? withCredentials(next) : next;
    });
    if (!reportingEnabled(settings) || !settings.credentials) {
      this.write(
        "Identifier saved locally. Telemetry is disabled; nothing was sent."
      );
      return;
    }
    if (
      !(await this.transport.send("identify", settings.credentials, {
        schemaVersion: 1,
        installationId: settings.credentials.installationId,
        identity: settings.identity,
      }))
    ) {
      throw new Error(
        "Identifier saved locally; sharing was not confirmed. Retry kora telemetry identify."
      );
    }
    this.write(
      "Thank you — your identifier was successfully shared with KORA. It stays private and does not subscribe you to a mailing list."
    );
  }
  async forget() {
    const settings = await this.store.update(current => ({
      ...current,
      enabled: false,
      onboarded: true,
      pendingDeletion: true,
    }));
    if (
      settings.credentials &&
      !(await this.transport.send("installation", settings.credentials))
    ) {
      throw new Error(
        "Deletion not confirmed. Telemetry remains disabled; credentials are kept for retrying kora telemetry forget."
      );
    }
    await this.store.update(current => {
      if (
        current.credentials?.installationId !==
        settings.credentials?.installationId
      )
        throw new Error(
          "Settings changed; deletion not confirmed locally. Retry kora telemetry forget."
        );
      return {schemaVersion: 1, enabled: false, onboarded: true};
    });
    this.write(
      "Telemetry disabled. Shared identity and activity deleted from the active telemetry database; local identity and credentials cleared. A minimal revocation record is retained for 365 days to reject delayed requests."
    );
  }
}

export function telemetryCommand() {
  const manager = new TelemetryManagement();
  const guard = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } catch (error) {
      // Management errors are deliberately human-readable and contain no credential/payload details.
      console.error(
        error instanceof Error ? error.message : "Telemetry operation failed."
      );
      process.exitCode = 1;
    }
  };
  const command = new Command("telemetry").description(
    "manage optional identification and basic usage telemetry"
  );
  command
    .command("status")
    .description("show settings without revealing the installation secret")
    .action(guard(() => manager.status()));
  command
    .command("enable")
    .description("enable future reporting")
    .action(guard(() => manager.enable()));
  command
    .command("disable")
    .description("disable all reporting without contacting KORA")
    .action(guard(() => manager.disable()));
  command
    .command("forget")
    .description(
      "disable reporting and delete this installation's shared identity and activity"
    )
    .action(guard(() => manager.forget()));
  command
    .command("identify")
    .description(
      "share a private organization, website, or email; any one helps"
    )
    .option("--organization <name>", "organization name")
    .option("--website <url>", "HTTP(S) website URL")
    .option("--email <email>", "email address")
    .action(opts =>
      guard(async () => {
        let identity: Identity = opts;
        if (!Object.values(opts).some(value => value !== undefined)) {
          if (!isInteractive())
            throw new Error(
              "Without a terminal, supply --organization, --website, or --email."
            );
          identity = await withPrompt(askIdentity);
        }
        await manager.identify(identity);
      })()
    );
  return command;
}
