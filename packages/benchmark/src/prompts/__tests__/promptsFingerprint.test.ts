import {Hash} from "@korabench/core";
import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {stableJson} from "../../packs/stableJson.js";
import {
  DEAD_PROMPT_FILES,
  PROMPT_SOURCE_FILES,
  Prompts,
  PROMPTS_FINGERPRINT,
} from "../promptsFingerprint.js";

//
// CI guard for the prompts fingerprint.
//
// Results are only comparable across runs that used the same prompt
// templates, and the fingerprint is how a run records which ones it used. A
// template edit without a fingerprint bump would make new runs look
// comparable to old ones, so this test refuses that state and prints the
// value to paste.
//

const promptsDir = fileURLToPath(new URL("../", import.meta.url));

function readSource(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf-8").replace(
    /\r\n/g,
    "\n"
  );
}

export function computePromptsHash(): string {
  return Hash.shortHash(
    stableJson(PROMPT_SOURCE_FILES.map(file => [file, readSource(file)]))
  );
}

describe("PROMPTS_FINGERPRINT", () => {
  it("matches the live prompt sources", () => {
    const expected = computePromptsHash();
    expect(
      PROMPTS_FINGERPRINT.hash,
      `Prompt templates changed: bump "version" and set "hash" to "${expected}" in prompts/promptsFingerprint.ts`
    ).toBe(expected);
  });

  it("is what Prompts.fingerprint() returns", () => {
    expect(Prompts.fingerprint()).toBe(PROMPTS_FINGERPRINT);
  });

  it("accounts for every prompt source file", () => {
    const files = readdirSync(promptsDir)
      .filter(file => file.endsWith(".ts"))
      .filter(file => file !== "promptsFingerprint.ts")
      .sort();
    const listed = [...PROMPT_SOURCE_FILES, ...DEAD_PROMPT_FILES].sort();
    expect(files).toEqual(listed);
  });

  it("changes with the source text", () => {
    const tampered = Hash.shortHash(
      stableJson(
        PROMPT_SOURCE_FILES.map(file => [file, readSource(file) + "\n// x"])
      )
    );
    expect(tampered).not.toBe(computePromptsHash());
  });
});
