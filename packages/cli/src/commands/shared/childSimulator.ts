import {
  MimesisPatch,
  type ChildResponseRequest,
  type PatchOutcome,
} from "@korabench/benchmark";
import type {ModelResponse} from "@korabench/core";
import {Model} from "../../models/model.js";
import {createSpecModel} from "../../profiles/roleModels.js";

//
// The MIMESIS child: the profile's user model drafts, the recipe's editor
// patches. Shared by `run` (every turn after the opening) and
// `revise-openings` (the opening, written once into the corpus).
//

export interface ChildSimulatorOptions {
  /** Called with each turn's draft, before the editor sees it. */
  onDraft?: (draft: string) => void;
  onOutcome?: (outcome: PatchOutcome) => void;
}

export function createChildSimulator(
  userModel: Model,
  options: ChildSimulatorOptions = {}
): (request: ChildResponseRequest) => Promise<ModelResponse> {
  const editor = createSpecModel(MimesisPatch.recipe.editor, {
    rejectTruncated: true,
  });
  return MimesisPatch.create({
    draft: async request => {
      const output = await userModel.getTextResponse(request);
      options.onDraft?.(output);
      return {output};
    },
    editor: async request => {
      try {
        return {output: await editor.getTextResponse(request)};
      } catch (error) {
        if (
          error instanceof Error &&
          /truncat|max.*tokens/i.test(error.message)
        )
          return {output: "", truncated: true};
        throw error;
      }
    },
    onOutcome: options.onOutcome,
  });
}
