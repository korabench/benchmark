import {toJsonSchema} from "@valibot/to-json-schema";
import * as v from "valibot";

//
// Provider-facing JSON schema.
//
// Structured-output providers enforce `minLength`/`maxLength` at decode time:
// the grammar closes a string the moment it reaches the cap, mid-word, and the
// model never gets to finish its sentence. Every scenario field capped in
// `model/scenario.ts` came back clipped that way in a large share of the
// shipped corpus. So the schema handed to the provider carries the length
// target only as prose in each field's description; the valibot caps stay as
// a wide safety net applied to the parsed output.
//
// The CLI runs one edition, whose caps are all prose, so every schema is
// stripped. Its judge schemas also carry `PROSE_LENGTH_CAPS_METADATA`, for a
// harness that serves older editions next to this one (kora-infra) and strips
// only what is marked.
//

type JsonSchemaNode = Record<string, unknown>;

const strippedKeys = new Set(["minLength", "maxLength"]);

function stripLengthConstraints(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripLengthConstraints);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node as JsonSchemaNode)
      .filter(([key]) => !strippedKeys.has(key))
      .map(([key, value]) => [key, stripLengthConstraints(value)])
  );
}

//
// Exports.
//

/**
 * The JSON schema sent to a provider for a structured response: the valibot
 * schema's JSON form with every string length constraint removed.
 */
export function toProviderSchema(
  outputType: v.GenericSchema
): Record<string, unknown> {
  return stripLengthConstraints(toJsonSchema(outputType)) as Record<
    string,
    unknown
  >;
}
