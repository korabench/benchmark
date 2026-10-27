import {Hash, type ModelMessage, type ModelRequest} from "@korabench/core";
import * as v from "valibot";
import recipe from "../../data/child/mimesis-multistep-patch.json" with {type: "json"};
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
}

export interface PatchOutcome {
  readonly status:
    | "unchanged"
    | "changed"
    | "invalid_correction_retained_draft";
  readonly issueCount: number;
  readonly editCount: number;
}

export interface MimesisPatchOptions {
  readonly draft: (request: ModelRequest) => Promise<ChildCompletion>;
  readonly editor: (request: ModelRequest) => Promise<ChildCompletion>;
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

function correction(
  text: string,
  draft: string,
  fields: Record<string, unknown>
) {
  const json = text.trim().startsWith("```")
    ? text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
    : text;
  const data = v.parse(VCorrection, JSON.parse(json));
  const allowed = new Set([
    ...Object.keys(fields),
    "actual_public_history",
    "original_scenario_and_profile",
  ]);
  if (
    data.issues.some(issue =>
      issue.source_fields.some(
        field =>
          !allowed.has(field.replace(/^original_scenario_and_profile\./, ""))
      )
    )
  )
    throw new Error("Invalid issue source field.");
  if (Boolean(data.issues.length) !== Boolean(data.edits.length))
    throw new Error("Issues and edits must both be empty or present.");
  const spans = data.edits
    .map(edit => {
      if (draft.split(edit.before).length !== 2)
        throw new Error("Edit must match one nonempty draft span.");
      const start = draft.indexOf(edit.before);
      return {start, end: start + edit.before.length, after: edit.after};
    })
    .toSorted((a, b) => a.start - b.start);
  if (spans.some((span, i) => i > 0 && spans[i - 1]!.end > span.start))
    throw new Error("Overlapping edits.");
  const output = spans
    .toReversed()
    .reduce(
      (text, span) =>
        text.slice(0, span.start) + span.after + text.slice(span.end),
      draft
    );
  if (!output.trim() || /<think>|<\/think>|<\|im_start\|>/.test(output))
    throw new Error("Invalid edited output.");
  return {output, issueCount: data.issues.length, editCount: data.edits.length};
}

function create(options: MimesisPatchOptions) {
  return async ({
    scenario,
    messages,
  }: ChildResponseRequest): Promise<{output: string}> => {
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
    const fields = source(scenario);
    const prompt = recipe.prompts[messages.length ? "continuation" : "opening"];
    const context = {
      ...fields,
      history: messages
        .map(m => `${m.role === "user" ? "CHILD" : "AI"}: ${m.content}`)
        .join("\n\n"),
    };
    const draft = await options.draft({
      maxTokens: recipe.draft.maxTokens,
      messages: [
        {
          role: "system",
          content:
            render(prompt.system, context) +
            "\n\n" +
            render(prompt.user, context),
        },
        ...messages.map(
          (m): ModelMessage => ({
            role: m.role === "user" ? "assistant" : "user",
            content: m.content,
          })
        ),
      ],
    });
    const original = draft.output.trim();
    if (
      draft.truncated ||
      !original ||
      /<\s*\/?\s*think\b|<\|im_start\|>/i.test(original)
    )
      throw new Error("Invalid MIMESIS draft.");
    const edited = await options.editor({
      maxTokens: recipe.editor.maxTokens,
      messages: [
        {role: "system", content: recipe.editorPrompt},
        {
          role: "user",
          content: JSON.stringify({
            original_scenario_and_profile: fields,
            actual_public_history: messages,
            draft: original,
          }),
        },
      ],
    });
    const result = ((): {output: string; outcome: PatchOutcome} => {
      try {
        if (edited.truncated) throw new Error("Editor response truncated.");
        const result = correction(edited.output, original, fields);
        return {
          output: result.output,
          outcome: {
            status: result.output === original ? "unchanged" : "changed",
            issueCount: result.issueCount,
            editCount: result.editCount,
          },
        };
      } catch {
        return {
          output: original,
          outcome: {
            status: "invalid_correction_retained_draft",
            issueCount: 0,
            editCount: 0,
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
    return {output: result.output};
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

/** The source prompts/configuration plus the approved visible-history and
 * opening policies. */
function fingerprint(benchmark: {version: string; hash: string}) {
  return {
    ...benchmark,
    hash: Hash.hash(
      stableJson({benchmark, child: recipe, opening: openingPolicy})
    ),
  };
}

export const MimesisPatch = {create, fingerprint, recipe, recipeRef};
