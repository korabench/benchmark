/** Operational counts only; never benchmark grades or model details. */
export interface ExecutionSummary {
  outcome: "completed" | "partial" | "failed" | "interrupted";
  work?: {
    unit: "seed" | "test";
    planned?: number;
    completed?: number;
    failed?: number;
    reused?: number;
  };
}

export function workSummary(
  unit: "seed" | "test",
  planned: number,
  succeeded: number,
  failed: number,
  reused: number
): ExecutionSummary {
  return {
    outcome: failed === 0 ? "completed" : succeeded > 0 ? "partial" : "failed",
    work: {unit, planned, completed: succeeded - reused, failed, reused},
  };
}
