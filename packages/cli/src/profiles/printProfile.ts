import {Mechanism, ModelSpec, Packs, RiskTaxonomy} from "@korabench/benchmark";
import * as R from "remeda";
import {describeProfileRef, EffectiveProfile} from "./effectiveProfile.js";
import {Role} from "./profile.js";
import {createSpecModel} from "./roleModels.js";

//
// Reporting.
//

function formatSpec(spec: ModelSpec): string {
  return `${spec.name}  ${JSON.stringify(ModelSpec.config(spec))}`;
}

export function printPacks(): void {
  const {taxonomy, behaviors} = Packs.current();
  const stamp = Packs.fingerprint();

  console.log(
    `Taxonomy:  ${RiskTaxonomy.label(taxonomy)} (${stamp.taxonomy.hash})`
  );
  console.log(
    `           ${taxonomy.categories.length} categories, ${RiskTaxonomy.allRisks(taxonomy).length} risks`
  );
  console.log(
    `Behaviors: ${behaviors.id}@${behaviors.version} (${stamp.behaviors.hash})`
  );
  console.log(
    `           ${behaviors.behaviors.map(Mechanism.codeOf).join(", ")}`
  );
}

/** One line per role, full config per model, so the printout is a record. */
export function printProfile(effective: EffectiveProfile, path?: string): void {
  console.log(`Profile:   ${describeProfileRef(effective.ref)}`);
  if (path) {
    console.log(`           ${path}`);
  }
  Role.list.forEach(role => {
    const specs = Role.specsOf(effective.roles, role);
    specs.forEach((spec, index) => {
      const head = index === 0 ? `${role}:`.padEnd(15) : "".padEnd(15);
      console.log(`  ${head}${formatSpec(spec)}`);
    });
  });
  console.log("");
  printPacks();
}

//
// Live check.
//

interface CheckOutcome {
  spec: ModelSpec;
  ok: boolean;
  served?: string;
  durationMs: number;
  error?: string;
}

async function checkSpec(spec: ModelSpec): Promise<CheckOutcome> {
  const model = createSpecModel(spec, {retry: {maxRetries: 0}});
  const started = Date.now();
  try {
    await model.getTextResponse({
      messages: [{role: "user", content: "Reply with the single word OK."}],
      maxTokens: 16,
    });
    return {
      spec,
      ok: true,
      served: [...model.served].join(","),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      spec,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Call every distinct model of the profile once. Returns `true` when every
 * call succeeded. Identical specs used by several roles are called once.
 */
export async function checkProfileModels(
  effective: EffectiveProfile
): Promise<boolean> {
  const specs = R.pipe(
    Role.list,
    R.flatMap(role => Role.specsOf(effective.roles, role)),
    R.uniqueBy(spec => JSON.stringify(spec))
  );
  console.log(`Checking ${specs.length} model(s)...`);

  const outcomes = await Promise.all(specs.map(checkSpec));
  outcomes.forEach(outcome => {
    const status = outcome.ok ? "PASS" : "FAIL";
    const detail = outcome.ok
      ? `served=${outcome.served}`
      : (outcome.error ?? "").slice(0, 200);
    console.log(
      `  ${status}  ${outcome.spec.name.padEnd(28)} ${outcome.spec.model.padEnd(32)} ${String(outcome.durationMs).padStart(6)}ms  ${detail}`
    );
  });

  const failed = outcomes.filter(outcome => !outcome.ok).length;
  console.log(
    failed === 0
      ? `All ${outcomes.length} model(s) answered.`
      : `${failed} of ${outcomes.length} model(s) failed.`
  );
  return failed === 0;
}
