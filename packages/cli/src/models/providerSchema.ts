import {JudgeLengthCaps} from "@korabench/benchmark";
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
// The one exception is a schema that asks for its caps to be enforced by the
// provider (`JudgeLengthCaps.enforcedByProvider`): the judge schemas of a run
// pinned to a taxonomy older than version 3, whose results have to stay
// comparable with the ones graded when that was the contract.
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
 * schema's JSON form with every string length constraint removed, unless the
 * schema asks for the provider to enforce them.
 */
export function toProviderSchema(
  outputType: v.GenericSchema
): Record<string, unknown> {
  const jsonSchema = toJsonSchema(outputType) as Record<string, unknown>;
  return JudgeLengthCaps.enforcedByProvider(outputType)
    ? jsonSchema
    : (stripLengthConstraints(jsonSchema) as Record<string, unknown>);
}
