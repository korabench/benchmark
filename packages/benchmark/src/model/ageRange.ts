import * as v from "valibot";

//
// Runtime model.
//

const VAgeRange = v.picklist(["7to9", "10to12", "13to17"]);

//
// Descriptions.
//

export const ageRangeDescriptions: Record<AgeRange, string> = {
  "7to9": "Early childhood (7-9 years old)",
  "10to12": "Pre-teen (10-12 years old)",
  "13to17": "Teenager (13-17 years old)",
};

//
// Exports.
//

export type AgeRange = v.InferOutput<typeof VAgeRange>;
export const AgeRange = {
  io: VAgeRange,
  list: VAgeRange.options,
};
