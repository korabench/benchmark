import {Hash, type ModelMessage, type ModelRequest} from "@korabench/core";
import * as v from "valibot";
import recipe from "../../data/child/mimesis-multistep-patch.json" with {type: "json"};
import placeholderFill from "../../data/child/placeholder-fill.json" with {type: "json"};
import {RiskCategory} from "../model/riskCategory.js";
import type {ChildSimulatorRef, Scenario} from "../model/scenario.js";
import {
  childSESDescriptions,
  refusalBehaviorDescriptions,
  riskSignalTypeDescriptions,
  seedMemoryDescriptions,
  seedUseDescriptions,
  socialContextDescriptions,
} from "../model/scenarioSeed.js";
import {SituationTypes} from "../model/situationTypes.js";
import {stableJson} from "../packs/stableJson.js";

export interface ChildCompletion {
  readonly output: string;
  readonly truncated?: boolean;
}

export interface ChildResponseRequest {
  readonly scenario: Scenario;
  /** Actual visible history: child=user, evaluated AI=assistant. Empty asks
   * for an opening, which `revise-openings` writes into the corpus once; runs
   * always send the stored one. */
  readonly messages: readonly ModelMessage[];
  /** An opening the scenario validation rejected, and why. Openings only:
   * the draft model and the editor are both shown it, so that the new draw
   * does not repeat what was rejected. */
  readonly feedback?: {
    readonly previousMessage: string;
    readonly reasons: readonly string[];
  };
}

/**
 * Why an edit was not applied and the draft kept: the editor's answer was cut
 * short ("truncated"), was not the JSON asked for ("unreadable"), held edits
 * that do not apply to the draft or issues that cite no source
 * ("invalid_edit"), gave a message that cannot be sent ("invalid_output"),
 * brought in a placeholder ("adds_placeholder"), or turned the draft into a
 * message the child already sent ("repeat").
 */
export type EditRejection =
  | "truncated"
  | "unreadable"
  | "invalid_edit"
  | "invalid_output"
  | "adds_placeholder"
  | "repeat";

/** Where the replacements of a draft's placeholders came from. */
export interface PlaceholderFills {
  /** The scenario's own anchor for the slot. */
  readonly anchor: number;
  /** The slot's generic option (`placeholder-fill.json`). */
  readonly option: number;
  /** No slot matched: the placeholder's own words, unbracketed. */
  readonly bare: number;
  /** Of those, the ones the editor chose among several candidates. */
  readonly picked: number;
}

/** Which of its two jobs the editor is called for: its pass over the draft,
 * or the choice of a placeholder's replacement. */
export type EditorCall = "edit" | "pick";

export interface PatchOutcome {
  readonly status:
    | "unchanged"
    | "changed"
    | "invalid_correction_retained_draft";
  readonly issueCount: number;
  readonly editCount: number;
  /** Drafts drawn again for carrying an end marker (`endMarker`). */
  readonly endMarkerRedraws: number;
  /** Drafts drawn again for carrying a placeholder the child made up
   * (`placeholder`) and no end marker. */
  readonly placeholderRedraws: number;
  /** Placeholders the last draw kept, replaced by the scenario's anchors or
   * the generic options (`fillPlaceholders`). */
  readonly placeholdersFilled: number;
  /** Where those replacements came from. Absent when nothing was filled. */
  readonly fills?: PlaceholderFills;
  /** Why the edit was not applied, with `invalid_correction_retained_draft`.
   * Recorded only: the draft is kept whatever the reason. */
  readonly editRejection?: EditRejection;
  /** The editor's judgement that the draft closes the child's side of the
   * conversation; null when its reply carried no readable flag. Recorded
   * only: the conversation still runs to its length. */
  readonly leaving: boolean | null;
}

/** The visible child message, and the turn's outcome. */
export interface ChildResponse {
  readonly output: string;
  readonly outcome?: PatchOutcome;
}

export interface MimesisPatchOptions {
  readonly draft: (request: ModelRequest) => Promise<ChildCompletion>;
  /** `call` says which of the editor's jobs the request is, for the caller's
   * own records; it is not part of the request. */
  readonly editor: (
    request: ModelRequest,
    call: EditorCall
  ) => Promise<ChildCompletion>;
  /** Optional text-free audit hook; never receives draft, reasoning or edits. */
  readonly onOutcome?: (outcome: PatchOutcome) => void;
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MIMESIS patch requires scenario field ${field}.`);
  }
  return value;
}

/** Same flattened source fields as research's benchmark-corpus loader. */
function source(scenario: Scenario): Record<string, string | number | null> {
  const {seed} = scenario;
  const category = RiskCategory.find(seed.riskCategoryId);
  const risk = RiskCategory.findRisk(category, seed.riskId);
  const situation = SituationTypes.forRisk(
    SituationTypes.bundled(),
    seed.riskId
  )
    ?.find(gs => gs.id === seed.goldStandardId)
    ?.situationTypes.find(s => s.name === seed.situationType);
  const fields = {
    scenario_id: seed.id,
    risk_id: seed.riskId,
    risk_category_id: seed.riskCategoryId,
    age_range: seed.ageRange,
    child_age: seed.childAge,
    child_gender: seed.childGender,
    child_race_ethnicity: seed.childRaceEthnicity,
    child_ses: seed.childSES,
    social_context: seed.socialContext,
    risk_signal_type: seed.riskSignalType,
    use: seed.use,
    refusal_behavior: seed.refusalBehavior,
    memory: seed.memory,
    gold_standard_id: seed.goldStandardId,
    situation_type: seed.situationType,
    child_ses_description: seed.childSES && childSESDescriptions[seed.childSES],
    use_description: seed.use && seedUseDescriptions[seed.use],
    social_context_description: socialContextDescriptions[seed.socialContext],
    risk_signal_type_description:
      riskSignalTypeDescriptions[seed.riskSignalType],
    refusal_behavior_description:
      seed.refusalBehavior && refusalBehaviorDescriptions[seed.refusalBehavior],
    memory_description: seed.memory && seedMemoryDescriptions[seed.memory],
    risk_name: risk.name,
    risk_description: risk.description,
    risk_category_name: category.name,
    situation_type_description: situation?.description,
    short_title: scenario.shortTitle,
    child_background: scenario.childBackground,
    narrative: scenario.narrative,
    motivation_name: seed.motivation.name,
    motivation_description: seed.motivation.description,
  };
  if (!Number.isInteger(seed.childAge))
    throw new Error("MIMESIS patch requires an exact child age.");
  if ((seed.memory === "established") !== Boolean(scenario.modelMemory)) {
    throw new Error(
      "MIMESIS patch scenario memory does not match its assigned relationship."
    );
  }
  return {
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        key === "child_age" ? (value as number) : required(value, key),
      ])
    ),
    model_memory: scenario.modelMemory ?? null,
  };
}

/**
 * A conversation-end marker ("[end]", "[end of conversation]"): a token from
 * MIMESIS's training transcripts, not something a child types. A draft that
 * carries one is drawn again, up to `draftDraws` draws in all; a marker the
 * last draw still carries is cut out.
 */
const endMarker = /\[\s*end\b[^\]\n]{0,30}\]/i;
const draftDraws = 3;

function withoutEndMarkers(text: string): string {
  return text
    .replace(new RegExp(endMarker.source, "gi"), " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * A fill-in placeholder ("[friend's name]", "[book title here]"): what the
 * draft model writes where the source names nobody and the prompt forbids
 * inventing a name. A child types "my friend". Once one is in the visible
 * history the next drafts copy it, so the first is the one to stop.
 *
 * The pattern cannot tell a placeholder from square brackets used as
 * parentheses, so nothing is ever cut on it: a draft that carries one is drawn
 * again, within the same `draftDraws` as the end marker. What the last draw
 * still carries is filled in (`fillPlaceholders`): the rest of the draft stays
 * as drawn. A bracket the evaluated AI wrote first (a template it offered:
 * "[Character A]") is the child quoting it, and is left alone.
 *
 * Openings have their own, stricter rule (`hasPlaceholder`): any bracket is
 * rejected and the opening written again, since nobody has spoken before it.
 */
const placeholder = /\[[A-Za-z][^\]\n]{0,60}\]/g;

function madeUpPlaceholders(
  text: string,
  messages: readonly ModelMessage[]
): readonly string[] {
  const offered = messages
    .filter(m => m.role === "assistant")
    .map(m => m.content.toLowerCase());
  return (text.match(placeholder) ?? []).filter(
    found => !offered.some(content => content.includes(found.toLowerCase()))
  );
}

/**
 * Fills the placeholders the last draw kept, so that no visible child message
 * carries one.
 *
 * The words that go in are never written by a model. They come from two fixed
 * lists, so a scenario reads the same whichever model is evaluated: the
 * scenario's `anchors` (the names it fixes for what it leaves unnamed) and the
 * generic options of `placeholder-fill.json` (the slots met so far, each with
 * the plain words a child would use: "my friend", "the book", "...").
 *
 * 1. A placeholder is matched to an option by its pattern ("[friend's name]"
 *    is the `friend` slot). With one anchor on that slot, or none, the value
 *    follows: the anchor's, else the option's. No model is called.
 * 2. A placeholder whose slot holds several anchors ("[Character A]" with two
 *    named characters) is put to the editor model with those anchors and the
 *    slot's own option. It answers with the id of one candidate, or "none";
 *    an id that is not a candidate is ignored.
 * 3. Whatever is left takes its option's value. A placeholder no pattern
 *    matches loses its brackets and keeps its words: a model asked to guess
 *    what it stood for did not answer the same way twice. A slot met often
 *    belongs in the options. This step cannot fail, which is what makes "no
 *    placeholder" hold.
 */
const VPicks = v.object({
  picks: v.array(v.object({placeholder: v.string(), pick: v.string()})),
});

type FillOption = (typeof placeholderFill.options)[number];

function optionOf(found: string): FillOption | undefined {
  const inner = found.slice(1, -1).trim();
  return placeholderFill.options.find(o =>
    new RegExp(o.pattern, "i").test(inner)
  );
}

/** A null value keeps the bracketed words themselves ("[him]" → "him"). */
function optionValue(option: FillOption, found: string): string {
  return option.value ?? found.slice(1, -1).trim();
}

interface FillCandidate {
  readonly id: string;
  readonly description: string;
  readonly value: string;
  /** Where the value comes from. An option with no word of its own gives the
   * placeholder's words back: "bare", like an unmatched slot. */
  readonly source: "anchor" | "option" | "bare";
}

/** A matched slot's own anchors, then its option. Empty when unmatched. */
function candidatesOf(found: string, scenario: Scenario): FillCandidate[] {
  const option = optionOf(found);
  if (!option) return [];
  return [
    ...(scenario.anchors ?? []).flatMap((anchor, i) =>
      option.anchorable && anchor.slot === option.key
        ? [
            {
              id: `anchor:${i}`,
              description: anchor.referent,
              value: anchor.value,
              source: "anchor" as const,
            },
          ]
        : []
    ),
    {
      id: `option:${option.key}`,
      description: option.description,
      value: optionValue(option, found),
      source: (option.value ?? undefined) === undefined ? "bare" : "option",
    },
  ];
}

function replaceEach(text: string, fills: ReadonlyMap<string, string>): string {
  return [...fills].reduce(
    (out, [found, value]) => out.split(found).join(value),
    text
  );
}

async function fillPlaceholders(
  draft: string,
  scenario: Scenario,
  messages: readonly ModelMessage[],
  editor: MimesisPatchOptions["editor"]
): Promise<{output: string; filled: number; fills?: PlaceholderFills}> {
  const found = [...new Set(madeUpPlaceholders(draft, messages))];
  if (!found.length) return {output: draft, filled: 0};
  const candidates = new Map(found.map(f => [f, candidatesOf(f, scenario)]));
  // Put to the model: a slot with several anchors on it, and nothing else.
  const open = found.filter(f => candidates.get(f)!.length > 2);
  const picked = open.length
    ? await (async (): Promise<ReadonlyMap<string, FillCandidate>> => {
        try {
          const reply = await editor(
            {
              maxTokens: recipe.editor.maxTokens,
              messages: [
                {role: "system", content: placeholderFill.prompt},
                {
                  role: "user",
                  content: JSON.stringify({
                    conversation: messages,
                    draft,
                    placeholders: open.map(f => ({
                      placeholder: f,
                      candidates: candidates
                        .get(f)!
                        .map(({id, description}) => ({id, description})),
                    })),
                  }),
                },
              ],
            },
            "pick"
          );
          if (reply.truncated) return new Map();
          const {picks} = v.parse(VPicks, editorJson(reply.output));
          return new Map(
            picks.flatMap(({placeholder: f, pick}) => {
              const chosen = candidates.get(f)?.find(c => c.id === pick);
              return open.includes(f) && chosen ? [[f, chosen] as const] : [];
            })
          );
        } catch {
          // An unreadable answer or a failed call: step 3.
          return new Map();
        }
      })()
    : new Map<string, FillCandidate>();
  // Without a pick: the slot's one anchor, else its option (the last
  // candidate), never one anchor among several; unmatched, the bare words.
  const chosen = found.map(f => {
    const list = candidates.get(f)!;
    const candidate =
      picked.get(f) ?? (list.length === 2 ? list[0] : list.at(-1));
    return {
      found: f,
      value: candidate?.value ?? f.slice(1, -1).trim(),
      source: candidate?.source ?? ("bare" as const),
      picked: picked.has(f),
    };
  });
  const count = (source: "anchor" | "option" | "bare") =>
    chosen.filter(c => c.source === source).length;
  return {
    output: replaceEach(draft, new Map(chosen.map(c => [c.found, c.value]))),
    filled: found.length,
    fills: {
      anchor: count("anchor"),
      option: count("option"),
      bare: count("bare"),
      picked: chosen.filter(c => c.picked).length,
    },
  };
}

/**
 * An edit that turns the draft into a message the child already sent. The
 * editor restores "an omitted scenario-defining request" by pasting the
 * opening, or the previous turn, over a draft that had moved on; the child
 * then says the same thing twice. Such an edit is invalid and the draft is
 * kept. Drafts are not checked: a child who insists does repeat themself, in
 * other words, and an edit to a draft that already repeats is judged as any
 * other edit.
 *
 * Similarity is the share of words in common (Dice, on multisets). Short
 * messages ("ok thanks") repeat naturally, so they must match exactly.
 */
const repeatSimilarity = 0.9;
const repeatMinWords = 5;

function words(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function wordSimilarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = b.reduce(
    (map, word) => map.set(word, (map.get(word) ?? 0) + 1),
    new Map<string, number>()
  );
  const shared = a.filter(word => {
    const left = counts.get(word) ?? 0;
    if (left > 0) counts.set(word, left - 1);
    return left > 0;
  }).length;
  return (2 * shared) / (a.length + b.length);
}

function repeatsEarlierMessage(
  text: string,
  messages: readonly ModelMessage[]
): boolean {
  const said = words(text);
  return messages
    .filter(m => m.role === "user")
    .map(m => words(m.content))
    .some(earlier =>
      Math.min(said.length, earlier.length) < repeatMinWords
        ? said.join(" ") === earlier.join(" ")
        : wordSimilarity(said, earlier) >= repeatSimilarity
    );
}

function render(
  text: string,
  fields: Record<string, string | number | null>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in fields))
      throw new Error(`Missing MIMESIS prompt field ${key}.`);
    return fields[key] === null ? "None" : String(fields[key]);
  });
}

const VCorrection = v.object({
  issues: v.array(
    v.object({
      problem: v.pipe(v.string(), v.trim(), v.minLength(1)),
      source_fields: v.pipe(v.array(v.string()), v.minLength(1)),
    })
  ),
  edits: v.array(
    v.object({before: v.pipe(v.string(), v.minLength(1)), after: v.string()})
  ),
});

function editorJson(text: string): unknown {
  const json = text.trim().startsWith("```")
    ? text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
    : text;
  return JSON.parse(json);
}

/** Read apart from the edits, so an invalid edit keeps the flag. */
function leavingFlag(text: string): boolean | null {
  try {
    const data = editorJson(text);
    return typeof data === "object" &&
      data !== null &&
      "leaving" in data &&
      typeof data.leaving === "boolean"
      ? data.leaving
      : null;
  } catch {
    return null;
  }
}

/** An edit that is not applied, and why (`EditRejection`). */
class EditRejected extends Error {
  constructor(
    readonly reason: EditRejection,
    message: string
  ) {
    super(message);
    this.name = "EditRejected";
  }
}

function correctionOf(text: string): v.InferOutput<typeof VCorrection> {
  try {
    return v.parse(VCorrection, editorJson(text));
  } catch {
    throw new EditRejected("unreadable", "Unreadable correction.");
  }
}

function correction(
  text: string,
  draft: string,
  fields: Record<string, unknown>,
  messages: readonly ModelMessage[]
) {
  const data = correctionOf(text);
  const allowed = new Set([
    ...Object.keys(fields),
    "actual_public_history",
    "original_scenario_and_profile",
    "rejected_previous_opening",
  ]);
  if (
    data.issues.some(issue =>
      issue.source_fields.some(
        field =>
          !field.startsWith("rejected_previous_opening.") &&
          !allowed.has(field.replace(/^original_scenario_and_profile\./, ""))
      )
    )
  )
    throw new EditRejected("invalid_edit", "Invalid issue source field.");
  if (Boolean(data.issues.length) !== Boolean(data.edits.length))
    throw new EditRejected(
      "invalid_edit",
      "Issues and edits must both be empty or present."
    );
  const spans = data.edits
    .map(edit => {
      if (draft.split(edit.before).length !== 2)
        throw new EditRejected(
          "invalid_edit",
          "Edit must match one nonempty draft span."
        );
      const start = draft.indexOf(edit.before);
      return {start, end: start + edit.before.length, after: edit.after};
    })
    .toSorted((a, b) => a.start - b.start);
  if (spans.some((span, i) => i > 0 && spans[i - 1]!.end > span.start))
    throw new EditRejected("invalid_edit", "Overlapping edits.");
  const output = spans
    .toReversed()
    .reduce(
      (text, span) =>
        text.slice(0, span.start) + span.after + text.slice(span.end),
      draft
    );
  if (
    !output.trim() ||
    /<think>|<\/think>|<\|im_start\|>/.test(output) ||
    endMarker.test(output)
  )
    throw new EditRejected("invalid_output", "Invalid edited output.");
  // Checked on a changed draft only: an edit must not bring in what a draft is
  // drawn again for, nor a message the child already sent.
  if (output !== draft) {
    const kept = new Set(madeUpPlaceholders(draft, messages));
    if (madeUpPlaceholders(output, messages).some(found => !kept.has(found)))
      throw new EditRejected("adds_placeholder", "Edit adds a placeholder.");
    if (
      repeatsEarlierMessage(output, messages) &&
      !repeatsEarlierMessage(draft, messages)
    )
      throw new EditRejected(
        "repeat",
        "Edit repeats an earlier child message."
      );
  }
  return {output, issueCount: data.issues.length, editCount: data.edits.length};
}

function create(options: MimesisPatchOptions) {
  return async ({
    scenario,
    messages,
    feedback,
  }: ChildResponseRequest): Promise<ChildResponse> => {
    if (
      messages.length % 2 !== 0 ||
      messages.some(
        (m, i) =>
          m.role !== (i % 2 === 0 ? "user" : "assistant") || !m.content.trim()
      )
    ) {
      throw new Error(
        "MIMESIS patch requires complete visible conversation turns."
      );
    }
    if (feedback && messages.length) {
      throw new Error("MIMESIS patch takes feedback on an opening only.");
    }
    const fields = source(scenario);
    const prompt = recipe.prompts[messages.length ? "continuation" : "opening"];
    const draftRequest: ModelRequest = {
      maxTokens: recipe.draft.maxTokens,
      messages: [
        {
          role: "system",
          content:
            render(prompt.system, fields) +
            "\n\n" +
            render(prompt.user, fields) +
            (feedback
              ? "\n\n" +
                render(recipe.prompts.opening.feedback, {
                  rejection_reasons: feedback.reasons
                    .map(reason => `- ${reason}`)
                    .join("\n"),
                  rejected_opening: feedback.previousMessage,
                })
              : ""),
        },
        // Replay the visible history once, with MIMESIS playing the child.
        ...messages.map(
          (m): ModelMessage => ({
            role: m.role === "user" ? "assistant" : "user",
            content: m.content,
          })
        ),
      ],
    };
    const drawDraft = async (
      n: number,
      redraws: {endMarker: number; placeholder: number}
    ): Promise<{
      output: string;
      redraws: {endMarker: number; placeholder: number};
    }> => {
      const draft = await options.draft(draftRequest);
      const output = draft.output.trim();
      if (
        draft.truncated ||
        !output ||
        /<\s*\/?\s*think\b|<\|im_start\|>/i.test(output)
      )
        throw new Error("Invalid MIMESIS draft.");
      const marked = endMarker.test(output);
      const filled = !marked && madeUpPlaceholders(output, messages).length > 0;
      if (!marked && !filled) return {output, redraws};
      if (n < draftDraws)
        return drawDraft(n + 1, {
          endMarker: redraws.endMarker + (marked ? 1 : 0),
          placeholder: redraws.placeholder + (filled ? 1 : 0),
        });
      // The last draw: an end marker is cut out, a placeholder is filled below.
      const kept = marked ? withoutEndMarkers(output) : output;
      if (!kept) throw new Error("Invalid MIMESIS draft.");
      return {output: kept, redraws};
    };
    const {output: drawn, redraws} = await drawDraft(1, {
      endMarker: 0,
      placeholder: 0,
    });
    const {
      output: original,
      filled,
      fills,
    } = await fillPlaceholders(drawn, scenario, messages, options.editor);
    // The scenario's anchors are source facts for the editor too: without
    // them it takes a filled-in name for an invented detail and edits it out
    // ("Zoe's mom" came back as "my friend's parent"). Shown only when the
    // scenario has some, so every other request is as before.
    const editorFields = scenario.anchors?.length
      ? {...fields, anchors: scenario.anchors}
      : fields;
    const edited = await options.editor(
      {
        maxTokens: recipe.editor.maxTokens,
        messages: [
          {role: "system", content: recipe.editorPrompt},
          {
            role: "user",
            content: JSON.stringify({
              original_scenario_and_profile: editorFields,
              actual_public_history: messages,
              ...(feedback
                ? {
                    rejected_previous_opening: {
                      message: feedback.previousMessage,
                      reasons: feedback.reasons,
                    },
                  }
                : {}),
              draft: original,
            }),
          },
        ],
      },
      "edit"
    );
    const leaving = edited.truncated ? null : leavingFlag(edited.output);
    const result = ((): {output: string; outcome: PatchOutcome} => {
      try {
        if (edited.truncated)
          throw new EditRejected("truncated", "Editor response truncated.");
        const result = correction(
          edited.output,
          original,
          editorFields,
          messages
        );
        return {
          output: result.output,
          outcome: {
            status: result.output === original ? "unchanged" : "changed",
            issueCount: result.issueCount,
            editCount: result.editCount,
            endMarkerRedraws: redraws.endMarker,
            placeholderRedraws: redraws.placeholder,
            placeholdersFilled: filled,
            ...(fills && {fills}),
            leaving,
          },
        };
      } catch (err) {
        return {
          output: original,
          outcome: {
            status: "invalid_correction_retained_draft",
            issueCount: 0,
            editCount: 0,
            endMarkerRedraws: redraws.endMarker,
            placeholderRedraws: redraws.placeholder,
            placeholdersFilled: filled,
            ...(fills && {fills}),
            editRejection:
              err instanceof EditRejected ? err.reason : "unreadable",
            leaving,
          },
        };
      }
    })();
    // Audit failures must not change which visible message was generated.
    try {
      options.onOutcome?.(result.outcome);
    } catch {
      /* best-effort observability */
    }
    return result;
  };
}

/** The recipe by content, as recorded in a scenario revision it wrote. */
function recipeRef(): ChildSimulatorRef {
  return {
    id: recipe.id,
    version: recipe.version,
    hash: Hash.hash(stableJson(recipe)),
  };
}

/**
 * Where a run's opening comes from. "corpus": the scenario's stored
 * `firstUserMessage`, written once by `revise-openings`. Runs that sampled the
 * opening per test, before, carried no policy and so a different hash.
 */
const openingPolicy = "corpus";

/** The source prompts/configuration plus the approved visible-history,
 * opening, end-marker, placeholder and repeated-message policies. */
function fingerprint(benchmark: {version: string; hash: string}) {
  return {
    ...benchmark,
    hash: Hash.hash(
      stableJson({
        benchmark,
        child: recipe,
        opening: openingPolicy,
        endMarker: {pattern: endMarker.source, draws: draftDraws},
        placeholder: {pattern: placeholder.source, draws: draftDraws},
        placeholderFill,
        repeat: {similarity: repeatSimilarity, minWords: repeatMinWords},
      })
    ),
  };
}

export const MimesisPatch = {
  create,
  fingerprint,
  recipe,
  recipeRef,
  placeholderFill,
};
