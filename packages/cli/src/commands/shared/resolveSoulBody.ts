import {readFileSync} from "node:fs";
import * as path from "node:path";

/**
 * Resolve the verbatim system-prompt body for the `soul` prompt variant.
 *
 * Resolution order:
 *   1. If SOUL_MD_PATH is set, read that file.
 *   2. Otherwise, read `<dataPath>/souls/seed.md`.
 *
 * Throws naming SOUL_MD_PATH on any failure (missing file, empty body, etc.)
 * so the CLI exits non-zero with an actionable message.
 */
export function resolveSoulBody(dataPath: string): string {
  const envPath = process.env.SOUL_MD_PATH;
  const seedPath = path.join(dataPath, "souls", "seed.md");

  const {body, resolvedPath} = (() => {
    if (envPath !== undefined && envPath.length > 0) {
      try {
        return {body: readFileSync(envPath, "utf-8"), resolvedPath: envPath};
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to read SOUL_MD_PATH=${envPath}: ${reason}`
        );
      }
    }

    try {
      return {body: readFileSync(seedPath, "utf-8"), resolvedPath: seedPath};
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to read soul body. Set SOUL_MD_PATH or provide ${seedPath} ` +
          `(${reason}).`
      );
    }
  })();

  if (body.trim().length === 0) {
    throw new Error(
      `Soul body at ${resolvedPath} is empty. Set SOUL_MD_PATH or populate ${resolvedPath}.`
    );
  }

  return body;
}
