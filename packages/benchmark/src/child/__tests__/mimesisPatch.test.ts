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
    expect(await f.reply({scenario, messages: []})).toMatchObject({
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
      leaving: null,
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

  it("sends every resumed message exactly once, including a long final reply", async () => {
    const f = fixture();
    const messages = [
      {role: "user" as const, content: "CHILD_OPENING_SENTINEL"},
      {role: "assistant" as const, content: "TARGET_FIRST_REPLY_SENTINEL"},
      {role: "user" as const, content: "CHILD_FOLLOWUP_SENTINEL"},
      {
        role: "assistant" as const,
        content: "TARGET_LONG_REPLY_SENTINEL\n" + "long reply ".repeat(2000),
      },
    ];
    const saved = structuredClone(messages);
    await f.reply({scenario, messages});

    const request = f.draft.mock.calls[0]![0];
    expect(request.messages).toHaveLength(messages.length + 1);
    expect(request.messages.map(m => m.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(request.messages.slice(1).map(m => m.content)).toEqual(
      messages.map(m => m.content)
    );
    const payload = request.messages.map(m => m.content).join("\n");
    for (const message of messages) {
      expect(request.messages[0]!.content).not.toContain(message.content);
      expect(payload.split(message.content)).toHaveLength(2);
    }
    expect(request.messages[0]!.content).not.toMatch(
      /CONVERSATION SO FAR|\{\{history\}\}/
    );
    expect(
      JSON.parse(f.editor.mock.calls[0]![0].messages[1]!.content)
        .actual_public_history
    ).toEqual(saved);
    expect(messages).toEqual(saved);
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
      expect(await f.reply({scenario, messages: []})).toMatchObject({
        output: original,
      });
      expect(f.draft).toHaveBeenCalledTimes(1);
      expect(f.editor).toHaveBeenCalledTimes(1);
      expect(f.outcome).toHaveBeenCalledWith({
        status: "invalid_correction_retained_draft",
        issueCount: 0,
        editCount: 0,
        endMarkerRedraws: 0,
        leaving: null,
      });
    }
  );

  it("retains a draft for a truncated correction, even when the partial JSON looks valid", async () => {
    const f = fixture(JSON.stringify(validEdit), true);
    expect(await f.reply({scenario, messages: []})).toMatchObject({
      output: original,
    });
    expect(f.outcome.mock.calls[0]![0].status).toBe(
      "invalid_correction_retained_draft"
    );
  });

  it("accepts unchanged and fenced-JSON corrections, plus simultaneous disjoint edits", async () => {
    const unchanged = fixture('{"issues":[],"edits":[]}');
    expect(await unchanged.reply({scenario, messages: []})).toMatchObject({
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
    expect(await f.reply({scenario, messages: []})).toMatchObject({
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
      expect(await f.reply({scenario, messages: []})).toMatchObject({
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
        leaving: null,
      });
    }
  );

  it("cuts the end marker out of the last draft, and fails a draft that is nothing else", async () => {
    const f = fixture('{"issues":[],"edits":[]}');
    f.draft.mockResolvedValue({output: "ok.  [end] see you"});
    expect(await f.reply({scenario, messages: []})).toMatchObject({
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
    expect(await f.reply({scenario, messages: []})).toMatchObject({
      output: "it's (2x + 3) [the weekend one]",
    });
    expect(f.draft).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{...validEdit, leaving: true}, true, "changed"],
    [{issues: [], edits: [], leaving: false}, false, "unchanged"],
    [
      {...validEdit, leaving: true, edits: [{before: "missing", after: "x"}]},
      true,
      "invalid_correction_retained_draft",
    ],
    [{...validEdit, leaving: "yes"}, null, "changed"],
  ] as const)(
    "reports the editor's leaving flag apart from its edits (%j)",
    async (reply, leaving, status) => {
      const f = fixture(JSON.stringify(reply));
      const response = await f.reply({scenario, messages: []});
      expect(response.outcome).toMatchObject({status, leaving});
      expect(f.outcome).toHaveBeenCalledWith(response.outcome);
    }
  );

  it("has no leaving flag for unreadable or truncated editor replies", async () => {
    const unreadable = fixture("not JSON");
    expect(
      (await unreadable.reply({scenario, messages: []})).outcome?.leaving
    ).toBeNull();
    const truncated = fixture(
      JSON.stringify({...validEdit, leaving: true}),
      true
    );
    expect(
      (await truncated.reply({scenario, messages: []})).outcome?.leaving
    ).toBeNull();
  });

  it("shows a rejected opening and its reasons to the draft model and the editor", async () => {
    const feedback = {
      previousMessage: "REJECTED_OPENING",
      reasons: ["firstMessageShowsUse: reads as a homework session"],
    };
    const f = fixture(
      JSON.stringify({
        issues: [
          {
            problem: "Use still missing",
            source_fields: ["rejected_previous_opening.reasons", "narrative"],
          },
        ],
        edits: [{before: "blue", after: "green"}],
      })
    );
    expect(await f.reply({scenario, messages: [], feedback})).toMatchObject({
      output: "the green plant is smaller",
      outcome: {status: "changed"},
    });
    const draft = f.draft.mock.calls[0]![0].messages[0]!.content;
    expect(draft).toContain("A PREVIOUS OPENING WAS REJECTED");
    expect(draft).toContain(
      "- firstMessageShowsUse: reads as a homework session"
    );
    expect(draft).toContain("REJECTED_OPENING");
    expect(draft).not.toContain("{{");
    const editor = JSON.parse(f.editor.mock.calls[0]![0].messages[1]!.content);
    expect(editor.rejected_previous_opening).toEqual({
      message: "REJECTED_OPENING",
      reasons: feedback.reasons,
    });

    // Without feedback neither model hears of a rejection.
    const plain = fixture();
    await plain.reply({scenario, messages: []});
    expect(plain.draft.mock.calls[0]![0].messages[0]!.content).not.toContain(
      "REJECTED"
    );
    expect(
      JSON.parse(plain.editor.mock.calls[0]![0].messages[1]!.content)
    ).not.toHaveProperty("rejected_previous_opening");

    // Feedback is for openings: a later turn was never validated.
    await expect(
      f.reply({
        scenario,
        messages: [
          {role: "user", content: "hi"},
          {role: "assistant", content: "hello"},
        ],
        feedback,
      })
    ).rejects.toThrow("opening only");
  });

  it("asks the editor for the leaving flag", () => {
    expect(MimesisPatch.recipe.version).toBe("5");
    expect(MimesisPatch.recipe.history).toBe("visible-native-messages-v1");
    expect(MimesisPatch.recipe.editorPrompt).toContain('{"leaving":false');
  });
});
