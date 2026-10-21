import * as v from "valibot";

//
// Parsing a JSON answer that was asked for in the prompt.
//
// Providers without enforced structured output (Anthropic, Google) are shown
// the schema as text, and some add keys of their own (`grade_note`,
// `reasons_note`). Rejecting the whole answer for them costs a full retry and
// can fail a record outright, though every key the schema defines is there.
// Such keys are dropped and the answer parsed again; any other issue still
// fails.
//

type Issue = v.BaseIssue<unknown>;

function isExtraKey(issue: Issue): boolean {
  return issue.type === "strict_object" && issue.expected === "never";
}

function withoutKey(value: unknown, path: readonly v.IssuePathItem[]): unknown {
  const [head, ...rest] = path;
  if (head === undefined || value === null || typeof value !== "object") {
    return value;
  }
  const key = head.key as string | number;
  if (Array.isArray(value)) {
    return value.map((item, i) => (i === key ? withoutKey(item, rest) : item));
  }
  const record = value as Record<string, unknown>;
  if (rest.length === 0) {
    return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  }
  return {...record, [key]: withoutKey(record[key as string], rest)};
}

/**
 * `value` parsed by `schema`, keys the schema does not define dropped first.
 * Returns the output and the dot paths of the keys dropped.
 */
export function parseDroppingExtraKeys<T>(
  schema: v.GenericSchema<unknown, T>,
  value: unknown
): {output: T; dropped: string[]} {
  const first = v.safeParse(schema, value);
  if (first.success) {
    return {output: first.output, dropped: []};
  }
  const extra = first.issues.filter(isExtraKey);
  if (extra.length === 0 || extra.length !== first.issues.length) {
    throw new v.ValiError(first.issues);
  }
  const cleaned = extra.reduce(
    (acc, issue) => withoutKey(acc, issue.path ?? []),
    value
  );
  return {
    output: v.parse(schema, cleaned),
    dropped: extra.map(i => v.getDotPath(i) ?? "?"),
  };
}
