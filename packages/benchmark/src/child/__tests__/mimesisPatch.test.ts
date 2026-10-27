import type {ModelRequest} from "@korabench/core";
import {describe, expect, it, vi} from "vitest";
import {createScenario, createScenarioSeed} from "../../__tests__/fixtures.js";
import {SituationTypes} from "../../model/situationTypes.js";
import {MimesisPatch} from "../mimesisPatch.js";

const standard = SituationTypes.forRisk(
  SituationTypes.bundled(),
  "violence_and_physical_harm"
)![0]!;
const scenario = createScenario({
  firstUserMessage: "SAVED_OPENING_MUST_NOT_BE_USED",
  evaluationCriteria: "PRIVATE_JUDGE_RUBRIC",
  seed: createScenarioSeed({
    goldStandardId: standard.id,
    situationType: standard.situationTypes.find(s => s.description)!.name,
    notes: "PRIVATE_GENERATION_NOTE",
  }),
});
const original = "the blue plant is smaller";
const validEdit = {
  issues: [{problem: "Source color mismatch", source_fields: ["narrative"]}],
  edits: [{before: "blue", after: "green"}],
};

function fixture(output = JSON.stringify(validEdit), truncated = false) {
  const draft = vi.fn(async (_request: ModelRequest) => ({output: original}));
  const editor = vi.fn(async (_request: ModelRequest) => ({output, truncated}));
  const outcome = vi.fn();
  return {
    draft,
    editor,
    outcome,
    reply: MimesisPatch.create({draft, editor, onOutcome: outcome}),
  };
}

describe("MIMESIS + one targeted patch pass", () => {
  it("generates an opening from the archived source prompts, applies only the exact edit, and excludes saved openings and judging data", async () => {
    const f = fixture();
    expect(await f.reply({scenario, messages: []})).toEqual({
      output: "the green plant is smaller",
    });
    expect(f.draft).toHaveBeenCalledTimes(1);
    expect(f.editor).toHaveBeenCalledTimes(1);
    const draft = f.draft.mock.calls[0]![0];
    expect(draft.maxTokens).toBe(4096);
    expect(draft.messages).toHaveLength(1);
    expect(draft.messages[0]!.content).toContain(
      MimesisPatch.recipe.prompts.opening.system
    );
    expect(draft.messages[0]!.content).toContain(
      "Write the child's opening message"
    );
    expect(draft.messages[0]!.content).not.toContain("{{");
    expect(f.editor.mock.calls[0]![0].maxTokens).toBe(8192);
    expect(f.editor.mock.calls[0]![0].messages[0]!.content).toBe(
      MimesisPatch.recipe.editorPrompt
    );
    expect(
      JSON.stringify([...f.draft.mock.calls, ...f.editor.mock.calls])
    ).not.toMatch(
      /SAVED_OPENING_MUST_NOT_BE_USED|PRIVATE_JUDGE_RUBRIC|PRIVATE_GENERATION_NOTE/
    );
    expect(f.outcome).toHaveBeenCalledWith({
      status: "changed",
      issueCount: 1,
      editCount: 1,
      endMarkerRedraws: 0,
    });
  });

  it("continues and resumes from only final visible history in swapped native roles", async () => {
    const f = fixture();
    const messages = [
      {role: "user" as const, content: "the green plant is smaller"},
      {role: "assistant" as const, content: "How much light does it get?"},
    ];
    const resumed = MimesisPatch.create({draft: f.draft, editor: f.editor});
    await resumed({scenario, messages});
    expect(f.draft.mock.calls[0]![0].messages.slice(1)).toEqual([
      {role: "assistant", content: messages[0]!.content},
      {role: "user", content: messages[1]!.content},
    ]);
    expect(f.draft.mock.calls[0]![0].messages[0]!.content).toContain(
      "Write the child's next message"
    );
    expect(
      JSON.parse(f.editor.mock.calls[0]![0].messages[1]!.content)
        .actual_public_history
    ).toEqual(messages);
  });

  it.each([
    "not JSON",
    JSON.stringify({...validEdit, issues: []}),
    JSON.stringify({...validEdit, edits: []}),
    JSON.stringify({
      ...validEdit,
      issues: [{problem: "claim", source_fields: ["invented"]}],
    }),
    JSON.stringify({...validEdit, edits: [{before: "missing", after: "x"}]}),
    JSON.stringify({...validEdit, edits: [{before: "", after: "x"}]}),
    JSON.stringify({
      ...validEdit,
      edits: [
        {before: "blue plant", after: "x"},
        {before: "plant", after: "y"},
      ],
    }),
    JSON.stringify({...validEdit, edits: [{before: original, after: ""}]}),
    JSON.stringify({
      ...validEdit,
      edits: [{before: "blue", after: "<think>leak</think>"}],
    }),
    JSON.stringify({...validEdit, edits: [{before: "blue", after: "[end]"}]}),
  ])(
    "retains and flags the first draft for invalid edits without another content attempt (%s)",
    async output => {
      const f = fixture(output);
      expect(await f.reply({scenario, messages: []})).toEqual({
        output: original,
      });
      expect(f.draft).toHaveBeenCalledTimes(1);
      expect(f.editor).toHaveBeenCalledTimes(1);
      expect(f.outcome).toHaveBeenCalledWith({
        status: "invalid_correction_retained_draft",
        issueCount: 0,
        editCount: 0,
        endMarkerRedraws: 0,
      });
    }
  );

  it("retains a draft for a truncated correction, even when the partial JSON looks valid", async () => {
    const f = fixture(JSON.stringify(validEdit), true);
    expect(await f.reply({scenario, messages: []})).toEqual({output: original});
    expect(f.outcome.mock.calls[0]![0].status).toBe(
      "invalid_correction_retained_draft"
    );
  });

  it("accepts unchanged and fenced-JSON corrections, plus simultaneous disjoint edits", async () => {
    const unchanged = fixture('{"issues":[],"edits":[]}');
    expect(await unchanged.reply({scenario, messages: []})).toEqual({
      output: original,
    });
    const f = fixture(
      "```json\n" +
        JSON.stringify({
          ...validEdit,
          edits: [...validEdit.edits, {before: "smaller", after: "taller"}],
        }) +
        "\n```"
    );
    expect(await f.reply({scenario, messages: []})).toEqual({
      output: "the green plant is taller",
    });
  });

  it("fails before model calls for missing source data or incomplete history", async () => {
    const f = fixture();
    await expect(
      f.reply({
        scenario: {
          ...scenario,
          seed: {...scenario.seed, situationType: undefined},
        },
        messages: [],
      })
    ).rejects.toThrow(/situation_type/);
    await expect(
      f.reply({scenario, messages: [{role: "user", content: "incomplete"}]})
    ).rejects.toThrow(/complete/);
    expect(f.draft).not.toHaveBeenCalled();
  });

  it("does not silently convert transport failures or invalid drafts into valid simulator turns", async () => {
    const f = fixture();
    f.editor.mockRejectedValue(new Error("Transport failed"));
    await expect(f.reply({scenario, messages: []})).rejects.toThrow(
      "Transport failed"
    );
    expect(f.outcome).not.toHaveBeenCalled();
    f.draft.mockResolvedValue({output: ""});
    await expect(f.reply({scenario, messages: []})).rejects.toThrow(
      /Invalid MIMESIS draft/
    );
    expect(f.editor).toHaveBeenCalledTimes(1);
  });

  it.each(["ok. [end]", "[END OF CONVERSATION]", "bye [end chat]"])(
    "draws a draft with an end marker again (%s)",
    async marked => {
      const f = fixture('{"issues":[],"edits":[]}');
      f.draft.mockResolvedValueOnce({output: marked});
      expect(await f.reply({scenario, messages: []})).toEqual({
        output: original,
      });
      expect(f.draft).toHaveBeenCalledTimes(2);
      expect(f.draft.mock.calls[1]![0]).toEqual(f.draft.mock.calls[0]![0]);
      expect(f.editor).toHaveBeenCalledTimes(1);
      expect(f.editor.mock.calls[0]![0].messages[1]!.content).not.toContain(
        marked
      );
      expect(f.outcome).toHaveBeenCalledWith({
        status: "unchanged",
        issueCount: 0,
        editCount: 0,
        endMarkerRedraws: 1,
      });
    }
  );

  it("cuts the end marker out of the last draft, and fails a draft that is nothing else", async () => {
    const f = fixture('{"issues":[],"edits":[]}');
    f.draft.mockResolvedValue({output: "ok.  [end] see you"});
    expect(await f.reply({scenario, messages: []})).toEqual({
      output: "ok. see you",
    });
    expect(f.draft).toHaveBeenCalledTimes(3);
    expect(f.outcome.mock.calls[0]![0].endMarkerRedraws).toBe(2);
    f.draft.mockResolvedValue({output: "[end]"});
    await expect(f.reply({scenario, messages: []})).rejects.toThrow(
      /Invalid MIMESIS draft/
    );
  });

  it("leaves brackets that are not an end marker alone", async () => {
    const f = fixture('{"issues":[],"edits":[]}');
    f.draft.mockResolvedValue({output: "it's (2x + 3) [the weekend one]"});
    expect(await f.reply({scenario, messages: []})).toEqual({
      output: "it's (2x + 3) [the weekend one]",
    });
    expect(f.draft).toHaveBeenCalledTimes(1);
  });
});
