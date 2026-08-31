import {AsyncLocalStorage} from "node:async_hooks";
import {BehaviorSet} from "./behaviorSet.js";
import {bundledPacks} from "./bundled.js";
import {PackStamp} from "./packStamp.js";
import {RiskTaxonomy} from "./riskTaxonomy.js";

//
// Runtime model.
//

/** The taxonomy + behavior set a piece of work runs against. */
export interface ActivePacks {
  taxonomy: RiskTaxonomy;
  behaviors: BehaviorSet;
}

export interface PacksOverride {
  taxonomy?: RiskTaxonomy;
  behaviors?: BehaviorSet;
}

//
// State.
//
// Two layers, deliberately:
//
//   - `configured` is process-wide and one-shot. The CLI resolves --taxonomy /
//     --behaviors once per invocation and every command reads it.
//   - `storage` is an async-context scope. kora-infra serves several runs
//     concurrently from a single Cloudflare isolate, so a mutable global is not
//     enough there; each run wraps its work in `Packs.run(...)`.
//
// Callers should pick one. Mixing them is legal but makes it much harder to
// reason about which pack a given schema was built from.
//

const storage = new AsyncLocalStorage<ActivePacks>();

let configured: ActivePacks | undefined;

//
// API.
//

function currentPacks(): ActivePacks {
  return storage.getStore() ?? configured ?? bundledPacks();
}

function isBundledDefault(): boolean {
  const active = currentPacks();
  const bundled = bundledPacks();
  return (
    active.taxonomy === bundled.taxonomy &&
    active.behaviors === bundled.behaviors
  );
}

function resolve(override: PacksOverride): ActivePacks {
  const bundled = bundledPacks();
  return {
    taxonomy: override.taxonomy ?? bundled.taxonomy,
    behaviors: override.behaviors ?? bundled.behaviors,
  };
}

function fingerprint(packs: ActivePacks = currentPacks()): PackStamp {
  return {
    taxonomy: {
      id: packs.taxonomy.id,
      version: packs.taxonomy.version,
      hash: RiskTaxonomy.fingerprint(packs.taxonomy),
    },
    behaviors: {
      id: packs.behaviors.id,
      version: packs.behaviors.version,
      hash: BehaviorSet.fingerprint(packs.behaviors),
    },
  };
}

/**
 * Set the process-wide packs. Idempotent for an identical pack; a second call
 * with different content throws rather than silently re-pointing schemas that
 * may already have been built and cached against the first.
 */
function configure(override: PacksOverride): void {
  const next = resolve(override);
  if (configured) {
    if (PackStamp.equals(fingerprint(configured), fingerprint(next))) {
      return;
    }
    throw new Error(
      "Packs.configure() called twice with different packs " +
        `(${RiskTaxonomy.label(configured.taxonomy)} then ${RiskTaxonomy.label(next.taxonomy)}). ` +
        "Use Packs.run() to scope different packs to different work."
    );
  }
  configured = next;
}

/** Run `fn` with `packs` active for its whole async context. */
function run<T>(packs: PacksOverride, fn: () => T): T {
  return storage.run(resolve(packs), fn);
}

/** Test-only: drop the process-wide configuration. */
function reset(): void {
  configured = undefined;
}

//
// Exports.
//

export const Packs = {
  configure,
  run,
  current: currentPacks,
  bundled: bundledPacks,
  resolve,
  fingerprint,
  isBundledDefault,
  reset,
};
