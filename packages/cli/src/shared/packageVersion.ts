import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

function nearestPackageJson(from: string): string {
  const candidate = join(from, "package.json");
  if (existsSync(candidate)) return candidate;
  const parent = dirname(from);
  if (parent === from) {
    throw new Error(`No package.json above ${from}.`);
  }
  return nearestPackageJson(parent);
}

/**
 * Version of the `@korabench/cli` package this code belongs to. Resolved by
 * walking up from this module, so it works from `build/` and from `src/`.
 */
export function readPackageVersion(): string {
  const pkgPath = nearestPackageJson(dirname(fileURLToPath(import.meta.url)));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version || "0.0.0";
}
