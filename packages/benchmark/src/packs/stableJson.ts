//
// API.
//

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, sortKeys((value as Record<string, unknown>)[key])])
  );
}

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every depth, so two structurally equal packs always hash to the same value
 * regardless of how they were built (JSON file, DB row, hand-assembled).
 * Array order is meaningful and preserved.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
