import {randomBytes, randomUUID} from "node:crypto";
import {constants} from "node:fs";
import * as fs from "node:fs/promises";
import {homedir} from "node:os";
import path from "node:path";
import * as v from "valibot";
import {identitySchema, uuid} from "./contract.js";

const settingsSchema = v.strictObject({
  schemaVersion: v.literal(1),
  enabled: v.boolean(),
  onboarded: v.boolean(),
  noticeShown: v.optional(v.boolean()),
  pendingDeletion: v.optional(v.boolean()),
  credentials: v.optional(
    v.strictObject({
      installationId: uuid,
      secret: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
    })
  ),
  identity: v.optional(identitySchema),
});
export type Settings = v.InferOutput<typeof settingsSchema>;
export const defaultSettings = (): Settings => ({
  schemaVersion: 1,
  enabled: true,
  onboarded: false,
});
export const settingsPath = () =>
  path.join(homedir(), ".kora", "telemetry.json");

// Unknown nonempty spellings fail closed. Empty and explicit false spellings do not opt out.
export function environmentOverrides(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return ["KORA_TELEMETRY_DISABLED", "DO_NOT_TRACK"].filter(key => {
    const value = env[key]?.trim().toLowerCase();
    return (
      value !== undefined &&
      value !== "" &&
      !["0", "false", "no", "off"].includes(value)
    );
  });
}
export function reportingEnabled(
  settings: Settings,
  env: NodeJS.ProcessEnv = process.env
) {
  return (
    environmentOverrides(env).length === 0 &&
    settings.enabled &&
    !settings.pendingDeletion
  );
}
export function withCredentials(settings: Settings): Settings {
  return {
    ...settings,
    credentials: settings.credentials ?? {
      installationId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
    },
  };
}

export class SettingsStore {
  constructor(readonly file = settingsPath()) {}

  async read(): Promise<Settings> {
    try {
      // Refuse symbolic links so identity/credentials never follow an unexpected target.
      const handle = await fs.open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        return v.parse(
          settingsSchema,
          JSON.parse(await handle.readFile("utf8"))
        );
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return defaultSettings();
      throw new Error(
        "Telemetry settings are unreadable or invalid; collection is skipped.",
        {cause: error}
      );
    }
  }

  async update(
    change: (settings: Settings) => Settings | Promise<Settings>
  ): Promise<Settings> {
    const directory = path.dirname(this.file);
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe telemetry settings directory.");
    await fs.chmod(directory, 0o700);
    const lock = this.file + ".lock";
    let acquired = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await fs.mkdir(lock, {mode: 0o700});
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    if (!acquired)
      throw new Error(
        "Telemetry settings are busy. If no KORA process is running, remove the stale telemetry.json.lock directory and retry."
      );
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const next = v.parse(settingsSchema, await change(await this.read()));
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(next, null, 2) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
      return next;
    } finally {
      await fs.rm(temporary, {force: true});
      await fs.rmdir(lock);
    }
  }
}
