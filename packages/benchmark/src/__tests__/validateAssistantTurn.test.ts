import {ModelMessage} from "@korabench/core";
import {describe, expect, it} from "vitest";
import {
  REFUSAL_SENTINEL,
  validateAssistantTurn,
} from "../validateAssistantTurn.js";

const conversation = (...userTurns: readonly string[]): ModelMessage[] =>
  userTurns.map(content => ({role: "user", content}));

const check = (content: string, lastUser = "how do I do this?") =>
  validateAssistantTurn(content, conversation(lastUser));

const LONG =
  "That sounds like a really tough spot to be in, and I'm glad you felt " +
  "able to bring it up. There are a few things worth thinking through " +
  "before you decide what to do next, and none of them have to happen all " +
  "at once. Start with whoever feels safest to talk to";

describe("defects", () => {
  it("flags a blank reply", () => {
    expect(check("   ")).toMatchObject({code: "empty"});
  });

  it("flags a button caption captured as the reply", () => {
    expect(check("Retry")).toMatchObject({code: "ui_chrome"});
    expect(check("Claude can make mistakes")).toMatchObject({
      code: "ui_chrome",
    });
  });

  it("flags a thinking shimmer label", () => {
    expect(check("Triangulating")).toMatchObject({code: "thinking_label"});
    expect(check("Analyzing your request")).toMatchObject({
      code: "thinking_label",
    });
  });

  it("flags a reply that is only app chrome", () => {
    expect(check("Gemini said Connecting to Maps")).toMatchObject({
      code: "chrome_only",
    });
  });

  it("flags the child's own message read back", () => {
    expect(check("How do I   DO this?")).toMatchObject({code: "echo_of_user"});
  });

  it("flags text captured twice", () => {
    const once = "You could try talking to someone you trust about it today.";
    expect(check(once + once)).toMatchObject({code: "doubled"});
  });

  it("reports the turn index and what was captured", () => {
    const messages: ModelMessage[] = [
      {role: "user", content: "hi"},
      {role: "assistant", content: "Hello! What's on your mind?"},
      {role: "user", content: "i feel bad"},
    ];
    expect(validateAssistantTurn("Triangulating", messages)).toEqual({
      code: "thinking_label",
      turnIndex: 3,
      captured: "Triangulating",
    });
  });
});

describe("replies that must not be flagged", () => {
  it("accepts the refusal sentinel", () => {
    expect(check(REFUSAL_SENTINEL)).toBeUndefined();
  });

  it("accepts a genuinely terse reply", () => {
    expect(check("Sure — what's up?")).toBeUndefined();
    expect(check("no")).toBeUndefined();
  });

  it("accepts a short gerund-led sentence", () => {
    expect(check("Sing along with me")).toBeUndefined();
    expect(check("Bring it up when you feel ready")).toBeUndefined();
  });

  it("accepts a long reply however it ends", () => {
    // Deliberately not a truncation detector: see auditCaptures.ts. Endings
    // without terminal punctuation are dominated by scraped suggestion chips,
    // which are a driver bug to fix, not a reason to throw away a transcript.
    expect(check(LONG)).toBeUndefined();
    expect(check(LONG + "\n\n- Talk to a trusted adult")).toBeUndefined();
    expect(check(LONG + " 😊")).toBeUndefined();
  });

  it("accepts chrome wrapped around a real answer", () => {
    expect(check("Gemini said " + LONG + ".")).toBeUndefined();
  });

  it("accepts an ordinary multi-paragraph answer", () => {
    expect(check(LONG + ".\n\n" + LONG + "!")).toBeUndefined();
  });

  it("accepts a reply that merely mentions a chrome word", () => {
    expect(check("You can hit retry if it fails.")).toBeUndefined();
  });
});

describe("regressions found against stored runs", () => {
  it("does not flag a real reply that opens like a status line", () => {
    // snapchat-myai turn that "connecting to .*" swallowed whole.
    expect(
      check(
        "Connecting to your phone's hotspot would use your phone's data, " +
          "not the school's Wi-Fi. However, your school might still have " +
          "monitoring software installed on the laptop itself."
      )
    ).toBeUndefined();
  });
});
