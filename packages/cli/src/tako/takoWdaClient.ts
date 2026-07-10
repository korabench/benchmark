import * as fs from "node:fs/promises";

interface WdaEnvelope<T> {
  value: T;
  sessionId?: string | null;
}

interface WdaElementReference {
  ELEMENT?: string;
  "element-6066-11e4-a52e-4f735466cecf"?: string;
}

interface WdaElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WdaErrorValue {
  error?: string;
  message?: string;
}

export type WdaElementType =
  | "XCUIElementTypeAny"
  | "XCUIElementTypeButton"
  | "XCUIElementTypeImage"
  | "XCUIElementTypeOther";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WdaRequestError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean
  ) {
    super(message);
    this.name = "WdaRequestError";
  }
}

export class TakoWdaClient {
  private sessionId: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly bundleId: string
  ) {}

  private async request<T>(
    method: "DELETE" | "GET" | "POST",
    pathname: string,
    body?: unknown,
    timeoutMs = 20_000
  ): Promise<T> {
    const url = new URL(pathname, `${this.baseUrl.replace(/\/$/, "")}/`);
    try {
      const response = await fetch(url, {
        method,
        headers:
          body === undefined ? undefined : {"content-type": "application/json"},
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `${method} ${url.pathname} returned ${response.status}: ${responseText}`
        );
      }
      if (!responseText.trim()) return undefined as T;
      const envelope = JSON.parse(responseText) as WdaEnvelope<T>;
      const value = envelope.value as WdaErrorValue | T;
      if (
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
      ) {
        throw new Error(value.message ?? value.error);
      }
      return envelope.value;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new WdaRequestError(
        `${method} ${url.pathname} failed: ${errorMessage(error)}`,
        timedOut
      );
    }
  }

  private sessionPath(pathname: string): string {
    if (!this.sessionId) throw new Error("WebDriverAgent session is not open.");
    return `session/${this.sessionId}/${pathname.replace(/^\//, "")}`;
  }

  private async focusedTextElement(): Promise<string> {
    const reference = await this.request<WdaElementReference>(
      "POST",
      this.sessionPath("element"),
      {
        using: "class chain",
        value:
          '**/XCUIElementTypeOther[`name == "TikTokTakoImpl.TakoInputContainerViewComponent"`]/**/XCUIElementTypeTextView[-1]',
      },
      20_000
    );
    const elementId =
      reference["element-6066-11e4-a52e-4f735466cecf"] ?? reference.ELEMENT;
    if (!elementId)
      throw new Error("Could not find Tako's focused text input.");
    return elementId;
  }

  private async clickElement(elementId: string): Promise<void> {
    try {
      await this.request(
        "POST",
        this.sessionPath(`element/${encodeURIComponent(elementId)}/click`),
        {},
        10_000
      );
    } catch (error) {
      if (!(error instanceof WdaRequestError) || !error.timedOut) throw error;
      await sleep(1_000);
    }
  }

  async connect(): Promise<void> {
    const status = await this.request<{ready?: boolean}>(
      "GET",
      "status",
      undefined,
      5_000
    );
    if (status.ready !== true) {
      throw new Error("WebDriverAgent responded, but is not ready.");
    }
    const session = await this.request<{sessionId?: string}>(
      "POST",
      "session",
      {
        capabilities: {
          alwaysMatch: {
            bundleId: this.bundleId,
            shouldTerminateApp: true,
            shouldUseSingletonTestManager: false,
          },
        },
      },
      30_000
    );
    if (!session.sessionId)
      throw new Error("WebDriverAgent did not return a session id.");
    this.sessionId = session.sessionId;

    await this.request(
      "POST",
      this.sessionPath("appium/settings"),
      {
        settings: {
          animationCoolOffTimeout: 0,
          snapshotMaxDepth: 70,
          useFirstMatch: true,
          waitForIdleTimeout: 0,
        },
      },
      10_000
    );
  }

  async source(timeoutMs = 25_000): Promise<string> {
    return this.request<string>(
      "GET",
      this.sessionPath("source"),
      undefined,
      timeoutMs
    );
  }

  async ensureAppActive(): Promise<void> {
    // Activating the session's app is a cheap no-op when it is already in the
    // foreground. It also avoids querying activeAppInfo, which can block while
    // XCTest is servicing a large TikTok hierarchy snapshot.
    await this.request(
      "POST",
      this.sessionPath("wda/apps/activate"),
      {bundleId: this.bundleId},
      15_000
    );
    await sleep(500);
  }

  private async findFirstNamedElement(
    names: readonly string[],
    visibleOnly: boolean,
    elementType: WdaElementType
  ): Promise<string | undefined> {
    if (names.length === 0) return undefined;
    const namePredicate = names
      .map(name => `name == ${JSON.stringify(name)}`)
      .join(" OR ");
    try {
      const reference = await this.request<WdaElementReference>(
        "POST",
        this.sessionPath("element"),
        {
          using: "class chain",
          value: `**/${elementType}[\`(${namePredicate})${visibleOnly ? " AND visible == 1" : ""}\`][1]`,
        },
        20_000
      );
      return (
        reference["element-6066-11e4-a52e-4f735466cecf"] ?? reference.ELEMENT
      );
    } catch (error) {
      if (
        error instanceof WdaRequestError &&
        error.message.toLocaleLowerCase().includes("no such element")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async findFirstVisibleNamedDescendant(
    ancestorName: string,
    ancestorType: WdaElementType,
    name: string,
    elementType: WdaElementType
  ): Promise<string | undefined> {
    const classChain = `**/${ancestorType}[\`name == ${JSON.stringify(ancestorName)}\`][1]/**/${elementType}[\`name == ${JSON.stringify(name)} AND visible == 1\`][1]`;
    try {
      const reference = await this.request<WdaElementReference>(
        "POST",
        this.sessionPath("element"),
        {using: "class chain", value: classChain},
        20_000
      );
      const elementId =
        reference["element-6066-11e4-a52e-4f735466cecf"] ?? reference.ELEMENT;
      return elementId;
    } catch (error) {
      if (
        error instanceof WdaRequestError &&
        error.message.toLocaleLowerCase().includes("no such element")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async clickFirstVisibleNamedDescendant(
    ancestorName: string,
    ancestorType: WdaElementType,
    name: string,
    elementType: WdaElementType
  ): Promise<boolean> {
    const elementId = await this.findFirstVisibleNamedDescendant(
      ancestorName,
      ancestorType,
      name,
      elementType
    );
    if (!elementId) return false;
    await this.clickElement(elementId);
    return true;
  }

  async hasNamedElement(
    names: readonly string[],
    visibleOnly = true,
    elementType: WdaElementType = "XCUIElementTypeAny"
  ): Promise<boolean> {
    return (
      (await this.findFirstNamedElement(names, visibleOnly, elementType)) !==
      undefined
    );
  }

  async clickFirstVisibleNamedElement(
    names: readonly string[],
    elementType: WdaElementType = "XCUIElementTypeAny"
  ): Promise<boolean> {
    const elementId = await this.findFirstNamedElement(
      names,
      true,
      elementType
    );
    if (!elementId) return false;
    await this.clickElement(elementId);
    return true;
  }

  async tap(x: number, y: number, timeoutMs = 10_000): Promise<void> {
    try {
      await this.request(
        "POST",
        this.sessionPath("actions"),
        {
          actions: [
            {
              type: "pointer",
              id: "finger",
              parameters: {pointerType: "touch"},
              actions: [
                {
                  type: "pointerMove",
                  duration: 0,
                  x: Math.round(x),
                  y: Math.round(y),
                  origin: "viewport",
                },
                {type: "pointerDown", button: 0},
                {type: "pause", duration: 100},
                {type: "pointerUp", button: 0},
              ],
            },
          ],
        },
        timeoutMs
      );
    } catch (error) {
      if (!(error instanceof WdaRequestError) || !error.timedOut) throw error;
      // TikTok's animated surfaces can keep XCTest's action response open
      // briefly after the touch was delivered. The next source read verifies
      // the resulting state, so a bounded action timeout is safe here.
      await sleep(1_500);
    }
  }

  async setFocusedText(text: string): Promise<string> {
    const elementId = await this.focusedTextElement();
    await this.clickElement(elementId);
    await this.request(
      "POST",
      this.sessionPath(`element/${encodeURIComponent(elementId)}/value`),
      {text, value: Array.from(text)},
      30_000
    );
    const value = await this.request<string | null>(
      "GET",
      this.sessionPath(
        `element/${encodeURIComponent(elementId)}/attribute/value`
      ),
      undefined,
      10_000
    );
    if (typeof value !== "string") {
      throw new Error("Tako's focused text input did not expose a value.");
    }
    return value;
  }

  async clickVisibleCopyButton(): Promise<void> {
    const elementId = await this.findFirstVisibleNamedDescendant(
      "TikTokTakoImpl.TakoInteractionElementComponentV2",
      "XCUIElementTypeOther",
      "Copy",
      "XCUIElementTypeButton"
    );
    if (!elementId) {
      throw new Error("Could not find Tako's visible Copy button.");
    }

    // TikTok's animated transcript can leave XCTest's element-click command
    // waiting indefinitely. Resolve the exact semantic button first, then ask
    // XCTest for its current native frame and deliver one touch at that live
    // frame. This is not an image-derived coordinate and cannot resolve to a
    // suggested reply with a different accessibility identity.
    const rect = await this.request<WdaElementRect>(
      "GET",
      this.sessionPath(`element/${encodeURIComponent(elementId)}/rect`),
      undefined,
      10_000
    );
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (
      values.some(value => !Number.isFinite(value)) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      throw new Error("Tako's Copy button returned an invalid native frame.");
    }
    await this.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  async getPasteboardText(): Promise<string> {
    const encoded = await this.request<string>(
      "POST",
      this.sessionPath("wda/getPasteboard"),
      {contentType: "plaintext"},
      15_000
    );
    return Buffer.from(encoded, "base64").toString("utf8");
  }

  async setPasteboardText(text: string): Promise<void> {
    await this.request(
      "POST",
      this.sessionPath("wda/setPasteboard"),
      {
        contentType: "plaintext",
        content: Buffer.from(text, "utf8").toString("base64"),
      },
      15_000
    );
  }

  async saveScreenshot(filePath: string): Promise<void> {
    const base64 = await this.request<string>(
      "GET",
      this.sessionPath("screenshot"),
      undefined,
      30_000
    );
    await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  }

  async swipeUp(timeoutMs = 10_000): Promise<void> {
    try {
      await this.request(
        "POST",
        this.sessionPath("actions"),
        {
          actions: [
            {
              type: "pointer",
              id: "finger",
              parameters: {pointerType: "touch"},
              actions: [
                {
                  type: "pointerMove",
                  duration: 0,
                  x: 215,
                  y: 760,
                  origin: "viewport",
                },
                {type: "pointerDown", button: 0},
                {type: "pause", duration: 100},
                {
                  type: "pointerMove",
                  duration: 500,
                  x: 215,
                  y: 310,
                  origin: "viewport",
                },
                {type: "pointerUp", button: 0},
              ],
            },
          ],
        },
        timeoutMs
      );
    } catch (error) {
      if (!(error instanceof WdaRequestError) || !error.timedOut) throw error;
      await sleep(1_500);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    await this.request(
      "DELETE",
      `session/${sessionId}`,
      undefined,
      5_000
    ).catch(() => {});
  }
}
