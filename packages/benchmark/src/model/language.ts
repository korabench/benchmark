import {unreachable} from "@korabench/core";
import * as v from "valibot";

//
// Runtime type.
//

const VLanguage = v.picklist(["en", "fr"]);

//
// Type exports.
//

export type Language = v.InferOutput<typeof VLanguage>;

//
// API.
//

const DEFAULT_LANGUAGE: Language = "en";

function languageToName(language: Language): string {
  switch (language) {
    case "en":
      return "English";

    case "fr":
      return "French";

    default:
      unreachable(language);
  }
}

//
// Exports.
//

export const Language = {
  io: VLanguage,
  list: VLanguage.options,
  default: DEFAULT_LANGUAGE,
  toName: languageToName,
};
