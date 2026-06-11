/**
 * Manual re-run driver for app-target scenarios that can't be driven
 * automatically (e.g. a web app that returns a transient backend error and
 * gets auto-skipped). Local, human-in-the-loop: the operator pastes each app
 * reply; this script records it and uses the SAME user-simulator the benchmark
 * uses (generateNextUserMessage) to produce the next user turn — keeping the
 * multi-turn conversation faithful to an automated run. Pair with
 * complete-run.mjs to judge the collected transcripts and finish the run.
 *
 * The transcript store (RUN_DIR/manual-reruns.json) is seeded by the operator,
 * one entry per scenario: {scenario, messages:[{role:"user",content:first}]}.
 *
 * Prereqts: packages are built (`yarn build`/`tsbuild`); models.json present.
 * Usage:
 *   RUN_DIR=data/<run> [USER_MODEL=deepseek-v3.2] \
 *     node --env-file=.env scripts/manual-rerun.mjs <idx> [assistantFile]
 *     <idx>           1-based scenario index into RUN_DIR/manual-reruns.json
 *     [assistantFile] file with the pasted app reply for the current turn;
 *                     omit to just (re)print the pending user message.
 */
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {
  generateNextUserMessage,
  RiskCategory,
} from "../packages/benchmark/build/src/index.js";
import {createGatewayModel} from "../packages/cli/build/src/models/gatewayModel.js";

const RUN_DIR = process.env.RUN_DIR ?? "data/2026-06-10-gemini-104";
const STORE = `${RUN_DIR}/manual-reruns.json`;
const MD = `${RUN_DIR}/manual-reruns.md`;
const USER_MODEL = process.env.USER_MODEL ?? "deepseek-v3.2";

const idx = Number(process.argv[2]);
const assistantFile = process.argv[3];
const store = JSON.parse(readFileSync(STORE, "utf8"));
if (!Number.isInteger(idx) || idx < 1 || idx > store.length) {
  throw new Error(`idx must be 1..${store.length}`);
}
const entry = store[idx - 1];

const category = RiskCategory.find(entry.scenario.seed.riskCategoryId);
const risk = RiskCategory.findRisk(category, entry.scenario.seed.riskId);
const conversationLength = risk.conversationLength;

const modelsJsonPath = path.resolve("models.json");
const userModel = createGatewayModel(modelsJsonPath, USER_MODEL);
const ctx = {
  getUserResponse: async request => ({
    output: await userModel.getTextResponse(request),
  }),
};

if (assistantFile) {
  const content = readFileSync(assistantFile, "utf8").trim();
  if (entry.messages[entry.messages.length - 1]?.role !== "user") {
    throw new Error(
      `Scenario ${idx} is not awaiting an assistant reply (last message is not a user turn).`
    );
  }
  entry.messages.push({role: "assistant", content});
}

const completedTurns = Math.floor(entry.messages.length / 2);
let nextUserMessage = null;

if (entry.messages[entry.messages.length - 1]?.role === "user") {
  nextUserMessage = entry.messages[entry.messages.length - 1].content;
} else if (completedTurns >= conversationLength) {
  entry.done = true;
} else {
  nextUserMessage = await generateNextUserMessage(
    ctx,
    risk,
    entry.scenario,
    entry.messages
  );
  entry.messages.push({role: "user", content: nextUserMessage});
}

writeFileSync(STORE, JSON.stringify(store, null, 2));

const md = [
  "# Gemini 104 — manual re-run of 8 auto-skipped (1099) scenarios",
  "",
  "Date: 2026-06-11. Target: Gemini (manual paste). These persistently returned",
  "backend error 1099 during the automated run and were auto-skipped via sentinel.",
  "",
  ...store.flatMap((e, i) => {
    const cl = RiskCategory.findRisk(
      RiskCategory.find(e.scenario.seed.riskCategoryId),
      e.scenario.seed.riskId
    ).conversationLength;
    const turns = Math.floor(e.messages.length / 2);
    const status = e.done
      ? `complete (${turns}/${cl} turns)`
      : `in progress (${turns}/${cl} turns)`;
    return [
      `## ${i + 1}. ${e.title}`,
      "",
      `- riskId: \`${e.riskId}\`  age: \`${e.age}\`  seed: \`${e.seed}\``,
      `- status: _${status}_`,
      "",
      ...e.messages.map(m => {
        const label = m.role === "user" ? "user (child)" : "assistant (Gemini)";
        return `**${label}:**\n\n> ${m.content.replace(/\n/g, "\n> ")}\n`;
      }),
      "---",
      "",
    ];
  }),
].join("\n");
writeFileSync(MD, md);

console.log(`\n=== Scenario ${idx}/${store.length}: ${entry.title} ===`);
console.log(
  `riskId=${entry.riskId} age=${entry.age}  budget=${conversationLength} turns`
);
console.log(`completed turns: ${Math.floor(entry.messages.length / 2)}`);
if (entry.done) {
  console.log("\n*** SCENARIO COMPLETE — all turns done. Move to next. ***");
} else if (nextUserMessage) {
  console.log(
    `\n----- PASTE THIS INTO GEMINI (turn ${Math.ceil(
      entry.messages.length / 2
    )}) -----\n`
  );
  console.log(nextUserMessage);
  console.log("\n------------------------------------------------------------");
}
