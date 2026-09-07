/**
 * Complete a run by replacing auto-skipped/sentinel testResults with real,
 * judge-graded results built from manually-collected conversations (see
 * manual-rerun.mjs, which produces the manual-reruns.json transcript store).
 *
 * For each manual entry it calls kora.runTest with the full transcript as
 * startMessages — the conversation loop is skipped (startTurn === budget) and
 * it goes straight to the judges — then overwrites the matching temp file
 * (matched by scenario.seed.id) under .kora-run-tmp so a subsequent
 * `kora run` cache-aggregates every result into the final results.json + .zip.
 *
 * Judges come from the evaluation profile (KORA_PROFILE, default "kora"),
 * exactly as in `kora run`; JUDGE is an override, warned and stamped like the
 * CLI's --judges. The run stamp is built from the profile and checked against
 * the temp dir's stamp.json the same way `kora run` does, so the manual
 * completion cannot silently use different judges than the automated part.
 *
 * Prereqts: packages are built (`yarn build`/`tsbuild`); models.json present.
 * Usage:
 *   RUN_DIR=data/<run> [KORA_PROFILE=kora] [JUDGE=<slug>[,<slug>…]] [TARGET=<slug>] \
 *     node --env-file=.env scripts/complete-run.mjs
 *   (RUN_DIR must contain manual-reruns.json and a .kora-run-tmp/ with the
 *    other cached results; re-run `kora run -o <RUN_DIR>/results.json` after.
 *    TARGET is the run's target slug, recorded in the stamp; defaults to the
 *    one in the temp dir's stamp.json when present.)
 */
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {kora, Stamp} from "../packages/benchmark/build/src/index.js";
import {
  assertResumable,
  listCachedFiles,
  STAMP_FILE,
} from "../packages/cli/build/src/commands/shared/cacheStamp.js";
import {
  describeProfileRef,
  resolveEffectiveProfile,
} from "../packages/cli/build/src/profiles/effectiveProfile.js";
import {
  loadProfile,
  profilesDir,
} from "../packages/cli/build/src/profiles/loadProfile.js";
import {Profiles} from "../packages/cli/build/src/profiles/profiles.js";
import {createJudgeModels} from "../packages/cli/build/src/profiles/roleModels.js";
import {buildRunStamp} from "../packages/cli/build/src/stamp/buildRunStamp.js";

const DIR = process.env.RUN_DIR ?? "data/2026-06-10-gemini-104";
const TMP = path.join(DIR, ".kora-run-tmp");
const STORE = path.join(DIR, "manual-reruns.json");

const modelsJsonPath = path.resolve("models.json");
Profiles.configure(
  loadProfile(process.env.KORA_PROFILE ?? "kora", profilesDir(modelsJsonPath))
);
const effective = resolveEffectiveProfile(modelsJsonPath, {
  judges: process.env.JUDGE?.split(",").map(s => s.trim()),
});
console.log(`Profile: ${describeProfileRef(effective.ref)}`);

// The target is not part of the profile; take it from the run's own stamp
// when the automated part left one, else from TARGET.
const cachedStampPath = path.join(TMP, STAMP_FILE);
const cachedTarget = existsSync(cachedStampPath)
  ? JSON.parse(readFileSync(cachedStampPath, "utf8"))?.models?.target
  : undefined;
const target = process.env.TARGET ?? cachedTarget?.slug ?? cachedTarget?.name;
if (!target) {
  console.error(
    "WARNING: no TARGET given and no stamp.json in the temp dir; the stamp will not name the target."
  );
}

const stamp = await buildRunStamp({effective, modelsJsonPath, target});
await assertResumable(TMP, stamp);
Stamp.configure(stamp);

const judgeModels = createJudgeModels(effective.roles.judges);

// Context: only judgeModels is exercised (the conversation loop is skipped).
const ctx = {
  getUserResponse: async () => {
    throw new Error("user model must not be called");
  },
  getAssistantResponse: async () => {
    throw new Error("assistant model must not be called");
  },
  judgeModels: Object.fromEntries(
    Object.entries(judgeModels).map(([name, model]) => [
      name,
      {
        getResponse: async request => ({
          output: await model.getStructuredResponse(request),
        }),
      },
    ])
  ),
};

// Map seed.id -> temp filename for the existing results.
const seedToFile = {};
for (const f of await listCachedFiles(TMP)) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(readFileSync(path.join(TMP, f), "utf8"));
  const id = d?.scenario?.seed?.id;
  if (id) seedToFile[id] = f;
}

const store = JSON.parse(readFileSync(STORE, "utf8"));

for (const entry of store) {
  const seedId = entry.scenario.seed.id;
  const file = seedToFile[seedId];
  if (!file)
    throw new Error(`No temp file for seed ${seedId} (${entry.title})`);

  const key = kora.mapScenarioToKeys(entry.scenario, ["default"])[0];
  const testResult = await kora.runTest(
    ctx,
    entry.scenario,
    key,
    entry.messages
  );

  writeFileSync(path.join(TMP, file), JSON.stringify(testResult, null, 2));

  const grade = testResult?.assessment?.grade ?? "?";
  console.log(`✓ ${entry.title}  →  ${file}  [grade: ${grade}]`);
}

console.log(
  `\nRe-judged ${store.length} scenarios. Now run \`kora run\` to aggregate.`
);
