import * as path from "node:path";

//
// Private corpus files.
//
// A share of the seeds, and the scenarios expanded from them, is held out of
// the published corpus. Those records live in a sibling file whose name carries
// `.private.` before the extension (`scenarioSeeds.private.jsonl`), a pattern
// `.gitignore` excludes wherever the file sits.
//

const MARKER = ".private";

/** True when `filePath` is itself a private corpus file. */
export function isPrivatePath(filePath: string): boolean {
  return path.basename(filePath).includes(`${MARKER}.`);
}

/**
 * The private sibling of `filePath`: `data/seeds.jsonl` →
 * `data/seeds.private.jsonl`. A path that is already private is returned as is.
 */
export function privatePathFor(filePath: string): string {
  if (isPrivatePath(filePath)) return filePath;
  const {dir, name, ext} = path.parse(filePath);
  if (ext.length === 0) {
    throw new Error(
      `Cannot derive a private file name from "${filePath}": it has no extension.`
    );
  }
  return path.join(dir, `${name}${MARKER}${ext}`);
}
