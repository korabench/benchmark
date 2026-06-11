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
 * Prereqts: packages are built (`yarn build`/`tsbuild`); models.json present.
 * Usage:
 *   RUN_DIR=data/<run> [JUDGE=gpt-5.2:medium:limited] \
 *     node --env-file=.env scripts/complete-run.mjs
 *   (RUN_DIR must contain manual-reruns.json and a .kora-run-tmp/ with the
 *    other cached results; re-run `kora run -o <RUN_DIR>/results.json` after.)
 */
import {readFileSync, readdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {kora} from "../packages/benchmark/build/src/index.js";
import {createGatewayModel} from "../packages/cli/build/src/models/gatewayModel.js";

const DIR = process.env.RUN_DIR ?? "data/2026-06-10-gemini-104";
const TMP = path.join(DIR, ".kora-run-tmp");
const STORE = path.join(DIR, "manual-reruns.json");
const JUDGE = process.env.JUDGE ?? "gpt-5.2:medium:limited";

const modelsJsonPath = path.resolve("models.json");
const judgeModel = createGatewayModel(modelsJsonPath, JUDGE);

// Context: only judgeModels is exercised (the conversation loop is skipped).
const ctx = {
  getUserResponse: async () => {
    throw new Error("user model must not be called");
  },
  getAssistantResponse: async () => {
    throw new Error("assistant model must not be called");
  },
  judgeModels: {
    [JUDGE]: {
      getResponse: async request => ({
        output: await judgeModel.getStructuredResponse(request),
      }),
    },
  },
};

// Map seed.id -> temp filename for the existing 104 results.
const seedToFile = {};
for (const f of readdirSync(TMP).filter(n => n.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(path.join(TMP, f), "utf8"));
  const id = d?.scenario?.seed?.id;
  if (id) seedToFile[id] = f;
}

const store = JSON.parse(readFileSync(STORE, "utf8"));

for (const entry of store) {
  const seedId = entry.scenario.seed.id;
  const file = seedToFile[seedId];
  if (!file) throw new Error(`No temp file for seed ${seedId} (${entry.title})`);

  const key = kora.mapScenarioToKeys(entry.scenario, ["default"])[0];
  const testResult = await kora.runTest(ctx, entry.scenario, key, entry.messages);

  writeFileSync(
    path.join(TMP, file),
    JSON.stringify(testResult, null, 2)
  );

  const grade = testResult?.assessment?.grade ?? "?";
  console.log(`✓ ${entry.title}  →  ${file}  [grade: ${grade}]`);
}

console.log(`\nRe-judged ${store.length} scenarios. Now run \`kora run\` to aggregate.`);
