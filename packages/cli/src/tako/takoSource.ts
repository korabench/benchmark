export type TakoMessageRole = "user" | "assistant";

export interface TakoMessage {
  role: TakoMessageRole;
  text: string;
}

export interface ScreenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementSection {
  role: TakoMessageRole;
  source: string;
}

interface OpenElement {
  role?: TakoMessageRole;
  start: number;
}

const COMPONENT_ROLES: Readonly<Record<string, TakoMessageRole>> = {
  "TikTokTakoImpl.TakoSendTextElementComponentV2": "user",
  "TikTokTakoImpl.TakoTextElementComponentV2": "assistant",
};

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (_entity, encoded: string) => {
      if (encoded.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(encoded.slice(2), 16));
      }
      if (encoded.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(encoded.slice(1), 10));
      }
      return (
        {
          amp: "&",
          apos: "'",
          gt: ">",
          lt: "<",
          quot: '"',
        } as const
      )[encoded.toLowerCase() as "amp" | "apos" | "gt" | "lt" | "quot"];
    }
  );
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

function componentRole(tag: string): TakoMessageRole | undefined {
  const name = attribute(tag, "name");
  return name === undefined ? undefined : COMPONENT_ROLES[name];
}

function findMessageSections(source: string): readonly ElementSection[] {
  const tagPattern = /<\/?XCUIElementType\w+\b[^>]*>/g;
  const initial: {
    stack: readonly OpenElement[];
    sections: readonly ElementSection[];
  } = {stack: [], sections: []};

  return [...source.matchAll(tagPattern)].reduce((state, match) => {
    const tag = match[0];
    const index = match.index;
    if (index === undefined) return state;

    if (tag.startsWith("</")) {
      const closed = state.stack.at(-1);
      if (!closed) return state;
      const stack = state.stack.slice(0, -1);
      if (!closed.role) return {...state, stack};
      return {
        stack,
        sections: [
          ...state.sections,
          {role: closed.role, source: source.slice(closed.start, index)},
        ],
      };
    }

    const role = componentRole(tag);
    if (tag.endsWith("/>")) {
      return role
        ? {
            ...state,
            sections: [...state.sections, {role, source: tag}],
          }
        : state;
    }
    return {
      stack: [...state.stack, {role, start: index}],
      sections: state.sections,
    };
  }, initial).sections;
}

function elementValues(
  section: string,
  elementType: string
): readonly string[] {
  const values = [
    ...section.matchAll(new RegExp(`<${elementType}\\b[^>]*>`, "g")),
  ]
    .map(match => attribute(match[0], "value")?.trim())
    .filter(
      (value): value is string =>
        Boolean(value) && !/^[\da-f]{8}$/i.test(value ?? "")
    );
  return values.filter((value, index) => value !== values[index - 1]);
}

function textViewValue(section: string): string | undefined {
  const tag = section.match(/<XCUIElementTypeTextView\b[^>]*>/)?.[0];
  const value = tag === undefined ? undefined : attribute(tag, "value");
  const textViewText = value?.trim();
  const staticText = elementValues(section, "XCUIElementTypeStaticText").join(
    "\n"
  );
  if (textViewText && staticText) {
    const prefix = textViewText.replace(/(?:\.\.\.|…)$/, "").trimEnd();
    return staticText.startsWith(prefix) ? staticText : undefined;
  }
  if (staticText) return staticText;
  // XCTest caps some long text-view values at 512 characters. Returning that
  // prefix as a complete benchmark response would silently lose content.
  return textViewText && textViewText.length !== 512 ? textViewText : undefined;
}

export function parseTakoMessages(source: string): readonly TakoMessage[] {
  return findMessageSections(source).flatMap(section => {
    const text = textViewValue(section.source);
    return text === undefined ? [] : [{role: section.role, text}];
  });
}

export function isTakoSource(source: string): boolean {
  return source.includes('name="TikTokTakoImpl.TakoRootComponent"');
}

export function findNamedFrame(
  source: string,
  elementName: string
): ScreenFrame | undefined {
  return findNamedFrames(source, elementName)[0];
}

export function findNamedFrames(
  source: string,
  elementName: string
): readonly ScreenFrame[] {
  return [...source.matchAll(/<XCUIElementType\w+\b[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => attribute(tag, "name") === elementName)
    .flatMap(tag => {
      const values = ["x", "y", "width", "height"].map(name =>
        Number(attribute(tag, name))
      );
      if (values.some(value => !Number.isFinite(value))) return [];
      const [x, y, width, height] = values;
      return x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
        ? []
        : [{x, y, width, height}];
    });
}

export function frameCenter(frame: ScreenFrame): {x: number; y: number} {
  return {x: frame.x + frame.width / 2, y: frame.y + frame.height / 2};
}
