import {describe, expect, it} from "vitest";
import {isNativeRunnerSlug} from "../models/nativeRunnerModel.js";
import {isWebRunnerSlug} from "../models/webRunnerModel.js";

describe("runner slug routing", () => {
  it("routes plain kora-app-* to web", () => {
    expect(isWebRunnerSlug("kora-app-chatgpt")).toBe(true);
    expect(isNativeRunnerSlug("kora-app-chatgpt")).toBe(false);
  });

  it("routes -android suffix to native", () => {
    expect(isNativeRunnerSlug("kora-app-tiktok-android")).toBe(true);
    expect(isWebRunnerSlug("kora-app-tiktok-android")).toBe(false);
  });

  it("ignores non-kora slugs entirely", () => {
    expect(isWebRunnerSlug("custom-something")).toBe(false);
    expect(isNativeRunnerSlug("custom-something")).toBe(false);
    expect(isWebRunnerSlug("anthropic/claude-opus-4-7")).toBe(false);
    expect(isNativeRunnerSlug("anthropic/claude-opus-4-7")).toBe(false);
  });
});
