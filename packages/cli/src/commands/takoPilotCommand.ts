import {Scenario} from "@korabench/benchmark";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import * as v from "valibot";
import {
  findNamedFrame,
  findNamedFrames,
  parseTakoMessages,
  TakoMessage,
} from "../tako/takoSource.js";
import {TakoWdaClient} from "../tako/takoWdaClient.js";
import {readScenariosFromJsonl} from "./runCommand.js";

const TIKTOK_BUNDLE_ID = "com.zhiliaoapp.musically";
const INPUT_COMPONENT = "TikTokTakoImpl.TakoInputContainerViewComponent";
const SEND_ICON = "IconPaperplaneFill";
const ASSISTANT_COMPONENT = "TikTokTakoImpl.TakoTextElementComponentV2";
const OCR_SCRIPT = path.resolve("scripts/tako-ocr.swift");
const UI_MATCH_SCRIPT = path.resolve("scripts/tako-ui-match.py");
const NEW_CHAT_TEMPLATE_SOURCE = path.resolve(
  "scripts/tako-new-chat-template.png.b64"
);
const COPY_TEMPLATE_SOURCE = path.resolve("scripts/tako-copy-template.png.b64");
const NEW_CHAT_STATE_CROP = "96x96+1038+207";
const COMPOSER_STATE_CROP = "120x120+1120+2495";
const RESPONSE_ACTIVE_DIFFERENCE = 0.08;
const RESPONSE_IDLE_DIFFERENCE = 0.04;
const RESPONSE_IDLE_POLLS = 2;
const NEW_CHAT_MATCH_DIFFERENCE = 0.04;
const COPY_MATCH_SCORE = 0.08;
const TAKO_ENTRY_Y_CANDIDATES = [380, 400, 420] as const;
const execFileAsync = promisify(execFile);

export type ScreenshotMode = "all" | "failures" | "none";
export type TakoExtractionMethod = "accessibility" | "clipboard" | "ocr";

export interface TakoPilotOptions {
  inputPath: string;
  outputPath: string;
  limit: number;
  riskIds?: readonly string[];
  wdaUrl: string;
  bundleId?: string;
  responseTimeoutMs: number;
  pollIntervalMs: number;
  screenshots: ScreenshotMode;
  ocrFallback: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface TakoPilotResult {
  schemaVersion: 1;
  runId: string;
  scenarioId: string;
  shortTitle: string;
  riskId: string;
  prompt: string;
  status: "completed" | "failed";
  assistantMessage?: string;
  startedAt: string;
  finishedAt: string;
  timingsMs: {
    reset: number;
    textEntry: number;
    response: number;
    total: number;
  };
  polls: number;
  input?: {
    requestedChars: number;
    acceptedChars: number;
    exact: boolean;
  };
  extraction?: {
    method: TakoExtractionMethod;
    reviewRequired: boolean;
    accessibilityChars: number;
    outputChars: number;
  };
  error?: string;
  screenshotPath?: string;
  sourcePath?: string;
}

interface PollResult {
  assistantMessage: string;
  accessibilityMessage: string;
  extractionMethod: TakoExtractionMethod;
  reviewRequired: boolean;
  polls: number;
}

interface ComposerPollState {
  responseStarted: boolean;
  idlePolls: number;
}

interface TakoUiTemplates {
  newChatPath: string;
  copyPath: string;
}

interface UiMatch {
  x: number;
  y: number;
  score: number;
}

interface AccessibilityCapture {
  source?: string;
  text?: string;
  error?: unknown;
}

class TakoSourceError extends Error {
  constructor(
    message: string,
    readonly source: string
  ) {
    super(message);
    this.name = "TakoSourceError";
  }
}

const TRANSIENT_ASSISTANT_TEXT =
  /^(searched \d+ sources?|searching(?: sources)?|thinking)\.?$/i;

export function selectTakoAssistantMessage(
  messages: readonly TakoMessage[],
  baselineAssistantCount: number
): string | undefined {
  return messages
    .filter(message => message.role === "assistant")
    .slice(baselineAssistantCount)
    .map(message => message.text.trim())
    .filter(text => text.length > 0 && !TRANSIENT_ASSISTANT_TEXT.test(text))
    .reduce<string | undefined>(
      (longest, text) =>
        longest === undefined || text.length > longest.length ? text : longest,
      undefined
    );
}

export function selectTakoAssistantForPrompt(
  messages: readonly TakoMessage[],
  expectedPrompt: string
): string | undefined {
  const normalizedPrompt = expectedPrompt.trim();
  const matchesPrompt = (message: string): boolean => {
    const normalizedMessage = message.trim();
    if (normalizedMessage === normalizedPrompt) return true;
    const collapsedPrefix = normalizedMessage
      .replace(/(?:\.\.\.|…)$/, "")
      .trimEnd();
    return (
      collapsedPrefix.length >= 80 &&
      normalizedPrompt.startsWith(collapsedPrefix)
    );
  };
  const promptIndex = messages.reduce(
    (latestIndex, message, index) =>
      message.role === "user" && matchesPrompt(message.text)
        ? index
        : latestIndex,
    -1
  );
  if (promptIndex < 0) return undefined;
  return selectTakoAssistantMessage(messages.slice(promptIndex + 1), 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function prepareUiTemplates(runId: string): Promise<TakoUiTemplates> {
  const decode = async (sourcePath: string, targetPath: string) => {
    const encoded = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(targetPath, Buffer.from(encoded.trim(), "base64"));
  };
  const newChatPath = path.join(tmpdir(), `kora-tako-new-chat-${runId}.png`);
  const copyPath = path.join(tmpdir(), `kora-tako-copy-${runId}.png`);
  await Promise.all([
    decode(NEW_CHAT_TEMPLATE_SOURCE, newChatPath),
    decode(COPY_TEMPLATE_SOURCE, copyPath),
  ]);
  return {newChatPath, copyPath};
}

async function removeUiTemplates(templates: TakoUiTemplates): Promise<void> {
  await Promise.all(
    [templates.newChatPath, templates.copyPath].map(filePath =>
      fs.rm(filePath, {force: true})
    )
  );
}

async function imageCropDifference(
  referencePath: string,
  candidatePath: string,
  crop: string
): Promise<number> {
  const {stdout} = await execFileAsync(
    "magick",
    [
      referencePath,
      candidatePath,
      "-crop",
      crop,
      "+repage",
      "-compose",
      "difference",
      "-composite",
      "-colorspace",
      "Gray",
      "-format",
      "%[fx:mean]",
      "info:",
    ],
    {maxBuffer: 64 * 1024}
  );
  const difference = Number(stdout.trim());
  if (!Number.isFinite(difference)) {
    throw new Error(
      `ImageMagick returned an invalid image difference: ${stdout.trim()}`
    );
  }
  return difference;
}

async function screenshotCropDifferenceFromTemplate(
  screenshotPath: string,
  templatePath: string,
  crop: string
): Promise<number> {
  const {stdout} = await execFileAsync(
    "magick",
    [
      screenshotPath,
      "-crop",
      crop,
      "+repage",
      templatePath,
      "-compose",
      "difference",
      "-composite",
      "-colorspace",
      "Gray",
      "-format",
      "%[fx:mean]",
      "info:",
    ],
    {maxBuffer: 64 * 1024}
  );
  const difference = Number(stdout.trim());
  if (!Number.isFinite(difference)) {
    throw new Error(
      `ImageMagick returned an invalid template difference: ${stdout.trim()}`
    );
  }
  return difference;
}

async function readSourceWithRetry(
  client: TakoWdaClient,
  remainingAttempts = 3
): Promise<string> {
  try {
    return await client.source();
  } catch (error) {
    if (remainingAttempts <= 1) throw error;
    await sleep(1_000);
    return readSourceWithRetry(client, remainingAttempts - 1);
  }
}

async function captureAssistantFromAccessibility(
  client: TakoWdaClient,
  expectedPrompt: string,
  remainingAttempts = 2,
  lastSource?: string
): Promise<AccessibilityCapture> {
  let source: string;
  try {
    source = await readSourceWithRetry(client);
  } catch (error) {
    if (remainingAttempts <= 1) return {source: lastSource, error};
    await sleep(750);
    return captureAssistantFromAccessibility(
      client,
      expectedPrompt,
      remainingAttempts - 1,
      lastSource
    );
  }

  const text = selectTakoAssistantForPrompt(
    parseTakoMessages(source),
    expectedPrompt
  );
  if (text) return {source, text};
  const error = new Error(
    "The accessibility snapshot did not contain the exact current prompt followed by an assistant response."
  );
  if (remainingAttempts <= 1) return {source, error};
  await sleep(750);
  return captureAssistantFromAccessibility(
    client,
    expectedPrompt,
    remainingAttempts - 1,
    source
  );
}

function normalizeOcrLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function dedupeOcrLines(pages: readonly (readonly string[])[]): string {
  return pages
    .flat()
    .reduce<readonly string[]>((lines, line) => {
      const trimmed = line.trim();
      if (!trimmed) return lines;
      const normalized = normalizeOcrLine(trimmed);
      return lines.some(existing => normalizeOcrLine(existing) === normalized)
        ? lines
        : [...lines, trimmed];
    }, [])
    .join(" ");
}

export function advanceComposerPollState(
  state: ComposerPollState,
  difference: number
): ComposerPollState {
  const responseStarted =
    state.responseStarted || difference >= RESPONSE_ACTIVE_DIFFERENCE;
  return {
    responseStarted,
    idlePolls:
      responseStarted && difference <= RESPONSE_IDLE_DIFFERENCE
        ? state.idlePolls + 1
        : 0,
  };
}

async function ocrResponseFrame(
  client: TakoWdaClient,
  source: string
): Promise<readonly string[]> {
  const frame = findNamedFrame(source, ASSISTANT_COMPONENT);
  if (!frame)
    throw new Error("Could not locate Tako's assistant response frame.");
  const top = Math.max(111, frame.y);
  const bottom = Math.min(821, frame.y + frame.height);
  if (bottom <= top) return [];

  const screenshotPath = path.join(tmpdir(), `kora-tako-${randomUUID()}.png`);
  await client.saveScreenshot(screenshotPath);
  try {
    const {stdout} = await execFileAsync(
      "xcrun",
      [
        "swift",
        OCR_SCRIPT,
        screenshotPath,
        String(Math.max(0, frame.x)),
        String(top),
        String(Math.min(430, frame.x + frame.width) - Math.max(0, frame.x)),
        String(bottom - top),
      ],
      {maxBuffer: 1024 * 1024}
    );
    return JSON.parse(stdout) as readonly string[];
  } finally {
    await fs.rm(screenshotPath, {force: true});
  }
}

async function captureFullAssistantWithOcr(
  client: TakoWdaClient,
  initialSource: string
): Promise<string | undefined> {
  const capture = async (
    source: string,
    pages: readonly (readonly string[])[],
    remainingPages: number
  ): Promise<string | undefined> => {
    const page = await ocrResponseFrame(client, source);
    const nextPages = [...pages, page];
    const copyIsVisible = findNamedFrames(source, "Copy").some(
      frame => frame.y >= 111 && frame.y + frame.height <= 821
    );
    if (copyIsVisible || remainingPages <= 1) {
      const result = dedupeOcrLines(nextPages).trim();
      return result.length ? result : undefined;
    }

    const currentY = findNamedFrame(source, ASSISTANT_COMPONENT)?.y;
    await client.swipeUp();
    await sleep(400);
    const nextSource = await readSourceWithRetry(client);
    const nextY = findNamedFrame(nextSource, ASSISTANT_COMPONENT)?.y;
    if (currentY === nextY) {
      const result = dedupeOcrLines(nextPages).trim();
      return result.length ? result : undefined;
    }
    return capture(nextSource, nextPages, remainingPages - 1);
  };

  return capture(initialSource, [], 8);
}

async function scrollUntilCopyVisible(
  client: TakoWdaClient,
  copyTemplatePath: string,
  remainingSwipes = 20
): Promise<void> {
  const screenshotPath = path.join(
    tmpdir(),
    `kora-tako-copy-search-${randomUUID()}.png`
  );
  try {
    await client.saveScreenshot(screenshotPath);
    const {stdout} = await execFileAsync(
      "python3",
      [UI_MATCH_SCRIPT, screenshotPath, copyTemplatePath, "240", "300", "2350"],
      {maxBuffer: 64 * 1024}
    );
    const match = JSON.parse(stdout) as UiMatch;
    if (match.score <= COPY_MATCH_SCORE) {
      await sleep(500);
      return;
    }
  } finally {
    await fs.rm(screenshotPath, {force: true});
  }
  if (remainingSwipes <= 0) {
    throw new Error("Could not locate Tako's Copy glyph on the response.");
  }
  await client.swipeUp();
  await sleep(250);
  return scrollUntilCopyVisible(client, copyTemplatePath, remainingSwipes - 1);
}

async function clickVisibleCopySafely(
  client: TakoWdaClient,
  copyTemplatePath: string
): Promise<void> {
  // Pixel matching is deliberately only a cheap visibility signal. The live
  // view can shift between a screenshot and a coordinate tap, and a nearby
  // suggested reply is not an acceptable substitute for Copy. Once visible,
  // require XCTest to resolve the exact semantic button.
  await scrollUntilCopyVisible(client, copyTemplatePath);
  await client.clickVisibleCopyButton();
}

async function captureFullAssistantWithClipboard(
  client: TakoWdaClient,
  copyTemplatePath: string
): Promise<string | undefined> {
  const readCopiedResponse = async (
    sentinel: string,
    remainingAttempts = 5
  ): Promise<string | undefined> => {
    await sleep(250);
    const copied = (
      await client.getPasteboardText().catch(() => sentinel)
    ).trim();
    if (copied !== sentinel && copied.length > 0) {
      return copied;
    }
    if (remainingAttempts <= 1) return undefined;
    return readCopiedResponse(sentinel, remainingAttempts - 1);
  };

  const original = await client.getPasteboardText().catch(() => undefined);
  const sentinel = `kora-tako-${randomUUID()}`;
  try {
    await client.setPasteboardText(sentinel);
    await clickVisibleCopySafely(client, copyTemplatePath);
    const copied = await readCopiedResponse(sentinel);
    if (!copied) {
      throw new Error(
        "Tako's exact Copy button was activated, but the pasteboard did not change."
      );
    }
    return copied;
  } finally {
    await client.setPasteboardText(original ?? "").catch(() => {});
  }
}

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readExistingResults(
  filePath: string
): Promise<readonly TakoPilotResult[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as TakoPilotResult);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function selectScenarios(
  options: TakoPilotOptions
): Promise<readonly Scenario[]> {
  const riskIds = options.riskIds?.length
    ? new Set(options.riskIds)
    : undefined;
  const selected: Scenario[] = [];
  for await (const scenario of readScenariosFromJsonl(options.inputPath, {
    riskIds,
  })) {
    if (selected.length >= options.limit) break;
    selected.push(v.parse(Scenario.io, scenario));
  }
  return selected;
}

async function waitForFreshConversation(): Promise<void> {
  await sleep(750);
}

async function newChatControlIsVisible(
  client: TakoWdaClient,
  newChatTemplatePath: string
): Promise<boolean> {
  const screenshotPath = path.join(
    tmpdir(),
    `kora-tako-header-${randomUUID()}.png`
  );
  try {
    await client.saveScreenshot(screenshotPath);
    const difference = await screenshotCropDifferenceFromTemplate(
      screenshotPath,
      newChatTemplatePath,
      NEW_CHAT_STATE_CROP
    );
    return difference <= NEW_CHAT_MATCH_DIFFERENCE;
  } finally {
    await fs.rm(screenshotPath, {force: true});
  }
}

async function openTakoFromFeed(
  client: TakoWdaClient,
  newChatTemplatePath: string,
  candidateIndex = 0
): Promise<void> {
  // WDA launches a fresh TikTok process for each harness invocation, which
  // starts on the For You feed. Tako's floating entry point is fixed on the
  // right edge of that feed. Its vertical position moves slightly with the
  // video layout, so try only the safe band above the profile-avatar control.
  await client.ensureAppActive();
  await sleep(1_500);
  const candidateY = TAKO_ENTRY_Y_CANDIDATES[candidateIndex];
  if (candidateY === undefined) {
    throw new Error("Tako did not open from its For You feed controls.");
  }
  await client.tap(398, candidateY);
  await sleep(1_500);
  if (await newChatControlIsVisible(client, newChatTemplatePath)) return;
  return openTakoFromFeed(client, newChatTemplatePath, candidateIndex + 1);
}

async function resetConversation(
  client: TakoWdaClient,
  newChatTemplatePath: string
): Promise<void> {
  // Element resolution can wedge XCTest when the previous Tako response has a
  // very large hierarchy. New Chat is fixed in the Tako navigation bar. Wait
  // out transient notification banners, tap its center, and let the subsequent
  // exact composer lookup/read-back prove that the intended UI is available.
  await client.ensureAppActive();
  await sleep(1_500);
  if (!(await newChatControlIsVisible(client, newChatTemplatePath))) {
    await openTakoFromFeed(client, newChatTemplatePath);
  }
  await client.tap(362, 85);
  await waitForFreshConversation();
  // Tako focuses the composer automatically after New Chat. This empty strip
  // is below the navigation bar and above every suggested prompt, so it safely
  // dismisses keyboards that do not expose a dismissal key.
  await client.tap(215, 150);
  await sleep(500);
  const source = await readSourceWithRetry(client);
  if (parseTakoMessages(source).length > 0) {
    throw new TakoSourceError(
      "Tako's New Chat control did not produce an empty conversation; refusing to risk stale transcript attribution.",
      source
    );
  }
}

async function enterPrompt(
  client: TakoWdaClient,
  prompt: string
): Promise<{requestedChars: number; acceptedChars: number; exact: boolean}> {
  const acceptedPrompt = await client.setFocusedText(prompt);
  const input = {
    requestedChars: prompt.length,
    acceptedChars: acceptedPrompt.length,
    exact: acceptedPrompt === prompt,
  };
  if (!input.exact) {
    await client.setFocusedText("").catch(() => {});
    throw new Error(
      `Tako did not retain the exact prompt (${input.acceptedChars}/${input.requestedChars} UTF-16 code units accepted); refusing to send a truncated benchmark case.`
    );
  }

  const sent = await client.clickFirstVisibleNamedDescendant(
    INPUT_COMPONENT,
    "XCUIElementTypeOther",
    SEND_ICON,
    "XCUIElementTypeButton"
  );
  if (!sent)
    throw new Error("Tako's send button did not appear after text entry.");
  return input;
}

async function pollForAssistant(
  client: TakoWdaClient,
  idleReferencePath: string,
  copyTemplatePath: string,
  expectedPrompt: string,
  options: Pick<
    TakoPilotOptions,
    "pollIntervalMs" | "responseTimeoutMs" | "ocrFallback"
  >
): Promise<PollResult> {
  const deadline = performance.now() + options.responseTimeoutMs;
  const candidatePath = path.join(
    tmpdir(),
    `kora-tako-state-${randomUUID()}.png`
  );

  const composerDifference = async (): Promise<number> => {
    await client.saveScreenshot(candidatePath);
    return imageCropDifference(
      idleReferencePath,
      candidatePath,
      COMPOSER_STATE_CROP
    );
  };

  const poll = async (
    polls: number,
    responseStarted: boolean,
    idlePolls: number
  ): Promise<PollResult> => {
    const difference = await composerDifference();
    const nextState = advanceComposerPollState(
      {responseStarted, idlePolls},
      difference
    );

    if (nextState.idlePolls >= RESPONSE_IDLE_POLLS) {
      const accessibility = await captureAssistantFromAccessibility(
        client,
        expectedPrompt
      );
      if (accessibility.text) {
        return {
          assistantMessage: accessibility.text,
          accessibilityMessage: accessibility.text,
          extractionMethod: "accessibility",
          reviewRequired: false,
          polls: polls + 1,
        };
      }

      let scrolledAccessibility: AccessibilityCapture | undefined;
      const scrollError = await scrollUntilCopyVisible(
        client,
        copyTemplatePath
      ).catch(error => error);
      if (!(scrollError instanceof Error)) {
        scrolledAccessibility = await captureAssistantFromAccessibility(
          client,
          expectedPrompt
        );
        if (scrolledAccessibility.text) {
          return {
            assistantMessage: scrolledAccessibility.text,
            accessibilityMessage: scrolledAccessibility.text,
            extractionMethod: "accessibility",
            reviewRequired: false,
            polls: polls + 1,
          };
        }
      }

      let clipboardError: unknown;
      const clipboardText = await captureFullAssistantWithClipboard(
        client,
        copyTemplatePath
      ).catch(error => {
        clipboardError = error;
        return undefined;
      });
      if (clipboardText) {
        return {
          assistantMessage: clipboardText,
          accessibilityMessage: "",
          extractionMethod: "clipboard",
          reviewRequired: false,
          polls: polls + 1,
        };
      }
      if (!options.ocrFallback) {
        const message = `Tako finished responding, but exact native extraction failed. Accessibility: ${describeError(scrolledAccessibility?.error ?? accessibility.error)} Scroll: ${describeError(scrollError)} Clipboard: ${describeError(clipboardError)} OCR is disabled by default; re-run with --ocr-fallback only if review-required output is acceptable.`;
        const failureSource =
          scrolledAccessibility?.source ?? accessibility.source;
        if (failureSource !== undefined)
          throw new TakoSourceError(message, failureSource);
        throw new Error(message);
      }
      const ocrSource =
        scrolledAccessibility?.source ??
        accessibility.source ??
        (await readSourceWithRetry(client).catch(() => undefined));
      if (ocrSource === undefined) {
        throw new Error(
          "Tako finished responding, but accessibility, Copy, and OCR source capture all failed."
        );
      }
      const latest = selectTakoAssistantForPrompt(
        parseTakoMessages(ocrSource),
        expectedPrompt
      );
      const ocrText = await captureFullAssistantWithOcr(
        client,
        ocrSource
      ).catch(() => undefined);
      if (ocrText && ocrText.length >= (latest?.length ?? 0)) {
        return {
          assistantMessage: ocrText,
          accessibilityMessage: latest ?? "",
          extractionMethod: "ocr",
          reviewRequired: true,
          polls: polls + 1,
        };
      }
      throw new TakoSourceError(
        "Tako finished responding, but Copy and OCR extraction both failed.",
        ocrSource
      );
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `Tako returned no completed, copyable response within ${options.responseTimeoutMs}ms.`
      );
    }
    await sleep(options.pollIntervalMs);
    return poll(polls + 1, nextState.responseStarted, nextState.idlePolls);
  };

  try {
    return await poll(0, false, 0);
  } finally {
    await fs.rm(candidatePath, {force: true});
  }
}

async function maybeSaveScreenshot(
  client: TakoWdaClient,
  artifactsDir: string,
  scenarioId: string,
  shouldSave: boolean
): Promise<string | undefined> {
  if (!shouldSave) return undefined;
  await fs.mkdir(artifactsDir, {recursive: true});
  const filePath = path.join(artifactsDir, `${scenarioId}.png`);
  await client.saveScreenshot(filePath);
  return filePath;
}

async function maybeSaveFailureSource(
  artifactsDir: string,
  scenarioId: string,
  error: unknown
): Promise<string | undefined> {
  if (!(error instanceof TakoSourceError)) return undefined;
  await fs.mkdir(artifactsDir, {recursive: true});
  const filePath = path.join(artifactsDir, `${scenarioId}.xml`);
  await fs.writeFile(filePath, error.source);
  return filePath;
}

async function runScenario(
  client: TakoWdaClient,
  runId: string,
  scenario: Scenario,
  options: TakoPilotOptions,
  artifactsDir: string,
  templates: TakoUiTemplates
): Promise<TakoPilotResult> {
  const totalStarted = performance.now();
  const startedAt = new Date().toISOString();
  const resetStarted = performance.now();
  let reset = 0;
  let textEntry = 0;
  let response = 0;
  let input:
    | {requestedChars: number; acceptedChars: number; exact: boolean}
    | undefined;
  const idleReferencePath = path.join(
    tmpdir(),
    `kora-tako-idle-${randomUUID()}.png`
  );

  try {
    await resetConversation(client, templates.newChatPath);
    reset = elapsedMs(resetStarted);
    await client.saveScreenshot(idleReferencePath);

    const textEntryStarted = performance.now();
    input = await enterPrompt(client, scenario.firstUserMessage);
    textEntry = elapsedMs(textEntryStarted);

    const responseStarted = performance.now();
    const polled = await pollForAssistant(
      client,
      idleReferencePath,
      templates.copyPath,
      scenario.firstUserMessage,
      options
    );
    response = elapsedMs(responseStarted);
    const screenshotPath = await maybeSaveScreenshot(
      client,
      artifactsDir,
      scenario.seed.id,
      options.screenshots === "all"
    );
    await fs.rm(idleReferencePath, {force: true});

    return {
      schemaVersion: 1,
      runId,
      scenarioId: scenario.seed.id,
      shortTitle: scenario.shortTitle,
      riskId: scenario.seed.riskId,
      prompt: scenario.firstUserMessage,
      status: "completed",
      assistantMessage: polled.assistantMessage,
      startedAt,
      finishedAt: new Date().toISOString(),
      timingsMs: {reset, textEntry, response, total: elapsedMs(totalStarted)},
      polls: polled.polls,
      input,
      extraction: {
        method: polled.extractionMethod,
        reviewRequired: polled.reviewRequired,
        accessibilityChars: polled.accessibilityMessage.length,
        outputChars: polled.assistantMessage.length,
      },
      screenshotPath,
    };
  } catch (error) {
    await fs.rm(idleReferencePath, {force: true});
    const sourcePath = await maybeSaveFailureSource(
      artifactsDir,
      scenario.seed.id,
      error
    );
    const screenshotPath = await maybeSaveScreenshot(
      client,
      artifactsDir,
      scenario.seed.id,
      options.screenshots !== "none"
    ).catch(() => undefined);
    return {
      schemaVersion: 1,
      runId,
      scenarioId: scenario.seed.id,
      shortTitle: scenario.shortTitle,
      riskId: scenario.seed.riskId,
      prompt: scenario.firstUserMessage,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      timingsMs: {reset, textEntry, response, total: elapsedMs(totalStarted)},
      polls: 0,
      input,
      error: describeError(error),
      screenshotPath,
      sourcePath,
    };
  }
}

function percentile(
  sorted: readonly number[],
  quantile: number
): number | undefined {
  if (sorted.length === 0) return undefined;
  const index = Math.ceil(quantile * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function summarizeTakoPilot(results: readonly TakoPilotResult[]) {
  const completed = results.filter(result => result.status === "completed");
  const totals = completed
    .map(result => result.timingsMs.total)
    .sort((a, b) => a - b);
  return {
    attempted: results.length,
    completed: completed.length,
    failed: results.length - completed.length,
    meanMs:
      totals.length === 0
        ? undefined
        : Math.round(
            totals.reduce((sum, value) => sum + value, 0) / totals.length
          ),
    medianMs: percentile(totals, 0.5),
    p95Ms: percentile(totals, 0.95),
    extractionMethods: {
      accessibility: completed.filter(
        result => result.extraction?.method === "accessibility"
      ).length,
      clipboard: completed.filter(
        result => result.extraction?.method === "clipboard"
      ).length,
      ocr: completed.filter(result => result.extraction?.method === "ocr")
        .length,
      unknown: completed.filter(result => result.extraction === undefined)
        .length,
    },
    reviewRequired: completed.filter(
      result => result.extraction?.reviewRequired === true
    ).length,
  };
}

export async function takoPilotCommand(
  options: TakoPilotOptions
): Promise<void> {
  const scenarios = await selectScenarios(options);
  if (scenarios.length === 0)
    throw new Error("No scenarios matched the pilot filters.");

  if (options.dryRun) {
    const preview = scenarios.map(scenario => ({
      scenarioId: scenario.seed.id,
      riskId: scenario.seed.riskId,
      shortTitle: scenario.shortTitle,
      promptChars: scenario.firstUserMessage.length,
      prompt: scenario.firstUserMessage,
    }));
    console.log(
      options.json
        ? JSON.stringify(preview)
        : preview
            .map(
              item => `${item.scenarioId}\t${item.riskId}\t${item.shortTitle}`
            )
            .join("\n")
    );
    return;
  }

  await fs.mkdir(path.dirname(options.outputPath), {recursive: true});
  const existing = await readExistingResults(options.outputPath);
  const completedIds = new Set(
    existing
      .filter(result => result.status === "completed")
      .map(result => result.scenarioId)
  );
  const pending = scenarios.filter(
    scenario => !completedIds.has(scenario.seed.id)
  );
  if (pending.length === 0) {
    console.log(
      options.json
        ? JSON.stringify(summarizeTakoPilot([]))
        : "All selected scenarios are already checkpointed."
    );
    return;
  }

  const runId = randomUUID();
  const artifactsDir = path.join(
    path.dirname(options.outputPath),
    "tako-pilot-artifacts",
    runId
  );
  const newResults: TakoPilotResult[] = [];
  const templates = await prepareUiTemplates(runId);

  try {
    for (const [index, scenario] of pending.entries()) {
      if (!options.json) {
        console.error(
          `[${index + 1}/${pending.length}] ${scenario.shortTitle}`
        );
      }
      // Isolate every conversation in its own WDA session. TikTok/XCTest can
      // invalidate a session after a failed native lookup; sharing that dead
      // session would otherwise turn every remaining checkpoint into an
      // infrastructure failure.
      const client = new TakoWdaClient(
        options.wdaUrl,
        options.bundleId ?? TIKTOK_BUNDLE_ID
      );
      await client.connect();
      const result = await runScenario(
        client,
        runId,
        scenario,
        options,
        artifactsDir,
        templates
      ).finally(() => client.disconnect());
      newResults.push(result);
      await fs.appendFile(options.outputPath, `${JSON.stringify(result)}\n`);
      if (!options.json) {
        console.error(
          result.status === "completed"
            ? `  completed in ${(result.timingsMs.total / 1000).toFixed(1)}s (${result.polls} transcript polls; extraction=${result.extraction?.method ?? "unknown"}${result.extraction?.reviewRequired ? ", review required" : ""})`
            : `  failed: ${result.error}`
        );
      }
    }
  } finally {
    await removeUiTemplates(templates);
  }

  const summary = summarizeTakoPilot(newResults);
  console.log(
    options.json
      ? JSON.stringify(summary)
      : `Pilot complete: ${summary.completed}/${summary.attempted} completed, ${summary.failed} failed; median=${summary.medianMs === undefined ? "n/a" : `${(summary.medianMs / 1000).toFixed(1)}s`}, p95=${summary.p95Ms === undefined ? "n/a" : `${(summary.p95Ms / 1000).toFixed(1)}s`}.`
  );
}
