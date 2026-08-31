import {ModelMessage} from "@korabench/core";
import {TurnIssue} from "./model/turnIssue.js";

//
// A capture-integrity check for a single assistant turn.
//
// Web-app targets are driven by browser automation, so what lands in the
// transcript is whatever the driver scraped off the page. When a driver
// regresses it does not error — it stores a plausible-looking string, the judge
// grades it, and the bogus score silently biases the leaderboard. Both incidents
// we have hit were found weeks later, by hand:
//
//   - Claude: thinking shimmer labels ("Triangulating") stored as the answer.
//   - Gemini: page chrome ("Gemini said", "Connecting to Maps") stored instead
//     of, or wrapped around, the answer.
//
// The rules below are lifted from the forensic scripts that found them, so a
// driver breaking the same way on any other app now fails at capture instead.
//
// These run on every turn of every run, so they are deliberately biased toward
// precision: a missed defect costs one bad score, but a false positive throws
// away a real conversation and re-runs a multi-minute browser session. Every
// threshold here is set to let an unusual-but-plausible reply through.
//

/** Emitted deliberately by the kora-apps drivers. A valid recorded outcome. */
export const REFUSAL_SENTINEL = "assistant refuses to engage";

/** A button caption or status line is always short. Without this bound the
 * open-ended alternatives below ("connecting to …") swallow real replies that
 * merely start the same way. */
const UI_CHROME_MAX_LENGTH = 60;

/** The whole reply is a button caption or status line. */
const UI_CHROME =
  /^(retry|copy|edit|share|claude can make mistakes|reply to claude|new chat|research|upgrade|continue|stop|regenerate|sonnet|opus|thinking|loading|typing\.*|searching the web|analyzing|gemini said|connecting to .*|showing results.*|just a sec.*)$/i;

/** Page furniture a driver may scrape alongside (or instead of) the answer. */
const CHROME_FRAGMENTS: readonly RegExp[] = [
  /Gemini said/g,
  /Connecting to\s+[\w .]*/g,
  /^(Searching the web|Analyzing|Thinking|Showing results.*|Just a sec.*)/gi,
  /This is for informational purposes only\.[\s\S]*?professional\./g,
];

/** A status label: one to three words, gerund-led, no sentence punctuation. */
const SHIMMER = /^[A-Za-z]+ing\b[\w\s,'-]*$/;
const SHIMMER_MAX_LENGTH = 40;
const SHIMMER_MAX_WORDS = 3;
/** Excludes short false-friends: "Sing along", "Bring it", "Thing". */
const SHIMMER_MIN_LEAD_WORD = 6;

/** Below this, whatever survived chrome-stripping is not an answer. */
const CHROME_ONLY_REMAINDER = 40;

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const norm = (text: string): string => collapse(text).toLowerCase();

const stripChrome = (text: string): string =>
  collapse(
    CHROME_FRAGMENTS.reduce((t, pattern) => t.replace(pattern, " "), text)
  );

const isShimmerLabel = (text: string): boolean => {
  if (text.length > SHIMMER_MAX_LENGTH || !SHIMMER.test(text)) return false;
  const words = text.split(/\s+/);
  const [lead] = words;
  return (
    words.length <= SHIMMER_MAX_WORDS &&
    lead !== undefined &&
    lead.length >= SHIMMER_MIN_LEAD_WORD
  );
};

const isDoubled = (text: string): boolean => {
  const half = text.length / 2;
  return (
    text.length > 40 &&
    text.length % 2 === 0 &&
    text.slice(0, half) === text.slice(half)
  );
};

/**
 * Check an assistant reply before it joins the transcript.
 *
 * `messages` is the conversation so far, ending with the user turn this reply
 * answers — the reply itself has not been appended yet, so its eventual index
 * is `messages.length`.
 *
 * Returns the first defect found, or `undefined` when the reply is usable.
 */
export function validateAssistantTurn(
  content: string,
  messages: readonly ModelMessage[]
): TurnIssue | undefined {
  const text = content.trim();
  const issue = (code: TurnIssue["code"]): TurnIssue => ({
    code,
    turnIndex: messages.length,
    captured: content,
  });

  // A recorded refusal is a real outcome, not a capture defect. Checked first
  // so no rule below can flag it.
  if (norm(text) === REFUSAL_SENTINEL) return undefined;

  if (text === "") return issue("empty");
  if (text.length <= UI_CHROME_MAX_LENGTH && UI_CHROME.test(text)) {
    return issue("ui_chrome");
  }

  if (isShimmerLabel(text)) return issue("thinking_label");

  // Only fires when chrome was actually present and removing it left nothing.
  // A short reply carrying no chrome is untouched, and stays valid — terse
  // answers are normal on apps like Snapchat.
  const stripped = stripChrome(text);
  if (stripped !== collapse(text) && stripped.length < CHROME_ONLY_REMAINDER) {
    return issue("chrome_only");
  }

  const lastUser = messages.findLast(m => m.role === "user")?.content.trim();
  if (
    lastUser !== undefined &&
    lastUser !== "" &&
    norm(text) === norm(lastUser)
  ) {
    return issue("echo_of_user");
  }

  if (isDoubled(text)) return issue("doubled");

  return undefined;
}
