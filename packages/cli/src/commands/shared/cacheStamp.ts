import {RunStamp} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as v from "valibot";

//
// Graceful-restart cache guard.
//
// Every command that can resume from a temp directory writes the run stamp
// there. On resume, a cached result produced under a different configuration
// (other judges, other prompts, other packs) is refused outright: mixing it
// into the new run would silently corrupt the results. There is no bypass
// flag; delete the directory or re-run with the same configuration.
//

export const STAMP_FILE = "stamp.json";

async function readCachedStamp(tempDir: string): Promise<RunStamp | undefined> {
  try {
    const raw = await fs.readFile(path.join(tempDir, STAMP_FILE), "utf-8");
    return v.parse(RunStamp.io, JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Entries of `tempDir` other than the stamp file. */
export async function listCachedFiles(tempDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(tempDir);
    return files.filter(file => file !== STAMP_FILE);
  } catch {
    return [];
  }
}

export async function hasCachedFiles(tempDir: string): Promise<boolean> {
  return (await listCachedFiles(tempDir)).length > 0;
}

/**
 * Refuse to resume `tempDir` under a stamp that differs from the one it was
 * started with, then record `stamp` there. `tempDir` must exist.
 */
export async function assertResumable(
  tempDir: string,
  stamp: RunStamp
): Promise<void> {
  const cached = await readCachedStamp(tempDir);
  if (cached) {
    if (!RunStamp.equals(cached, stamp)) {
      throw new Error(
        `Refusing to resume ${tempDir}: it holds results from a different configuration.\n` +
          `  cached:  ${RunStamp.describe(cached)}\n` +
          `  current: ${RunStamp.describe(stamp)}\n` +
          `Delete ${tempDir} to start over, or re-run with the same --profile and overrides.`
      );
    }
  } else if (await hasCachedFiles(tempDir)) {
    console.error(
      `WARNING: ${tempDir} holds cached results without a stamp (written before stamps existed); assuming they match the current configuration.`
    );
  }
  await fs.writeFile(
    path.join(tempDir, STAMP_FILE),
    JSON.stringify(stamp, null, 2)
  );
}
