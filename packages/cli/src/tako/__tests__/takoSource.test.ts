import {describe, expect, it} from "vitest";
import {
  findNamedFrame,
  findNamedFrames,
  frameCenter,
  isTakoSource,
  parseTakoMessages,
} from "../takoSource.js";

const SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="TikTok">
  <XCUIElementTypeOther name="TikTokTakoImpl.TakoRootComponent" x="0" y="0" width="430" height="932">
    <XCUIElementTypeOther name="TikTokTakoImpl.TakoSendTextElementComponentV2">
      <XCUIElementTypeTextView value="Can I use &quot;old facts&quot;?" />
    </XCUIElementTypeOther>
    <XCUIElementTypeOther name="TikTokTakoImpl.TakoTextElementComponentV2">
      <XCUIElementTypeOther>
        <XCUIElementTypeTextView value="Treat them as historical prej">
          <XCUIElementTypeStaticText value="Treat them as historical prejudice." />
          <XCUIElementTypeStaticText value="Add context &amp; sources." />
          <XCUIElementTypeStaticText value="7afa33c0" />
          <XCUIElementTypeStaticText value="7afa33c0" />
        </XCUIElementTypeTextView>
      </XCUIElementTypeOther>
    </XCUIElementTypeOther>
    <XCUIElementTypeOther name="TikTokTakoImpl.TakoInputContainerViewComponent" x="0" y="821" width="430" height="111" />
  </XCUIElementTypeOther>
</XCUIElementTypeApplication>`;

describe("parseTakoMessages", () => {
  it("extracts user and assistant text without duplicating nested static text", () => {
    expect(parseTakoMessages(SOURCE)).toEqual([
      {role: "user", text: 'Can I use "old facts"?'},
      {
        role: "assistant",
        text: "Treat them as historical prejudice.\nAdd context & sources.",
      },
    ]);
  });

  it("rejects stale static children that do not match the current text view", () => {
    const source = SOURCE.replace(
      'value="Treat them as historical prejudice."',
      'value="A stale response from the previous chat."'
    ).replace(
      'value="Add context &amp; sources."',
      'value="More stale response text."'
    );

    expect(parseTakoMessages(source)).toEqual([
      {role: "user", text: 'Can I use "old facts"?'},
    ]);
  });

  it("rejects a 512-character text-view prefix without matching child text", () => {
    const prefix = "x".repeat(512);
    const source = SOURCE.replace(
      /<XCUIElementTypeOther name="TikTokTakoImpl\.TakoTextElementComponentV2">[\s\S]*?<\/XCUIElementTypeOther>\s*<XCUIElementTypeOther name="TikTokTakoImpl\.TakoInputContainerViewComponent"/,
      `<XCUIElementTypeOther name="TikTokTakoImpl.TakoTextElementComponentV2"><XCUIElementTypeTextView value="${prefix}" /></XCUIElementTypeOther><XCUIElementTypeOther name="TikTokTakoImpl.TakoInputContainerViewComponent"`
    );

    expect(parseTakoMessages(source)).toEqual([
      {role: "user", text: 'Can I use "old facts"?'},
    ]);
  });
});

describe("Tako source landmarks", () => {
  it("detects the Tako screen and extracts component frames", () => {
    expect(isTakoSource(SOURCE)).toBe(true);
    const frame = findNamedFrame(
      SOURCE,
      "TikTokTakoImpl.TakoInputContainerViewComponent"
    );
    expect(frame).toEqual({x: 0, y: 821, width: 430, height: 111});
    expect(frame && frameCenter(frame)).toEqual({x: 215, y: 876.5});
    expect(
      findNamedFrames(SOURCE, "TikTokTakoImpl.TakoInputContainerViewComponent")
    ).toEqual([{x: 0, y: 821, width: 430, height: 111}]);
  });
});
