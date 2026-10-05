// The step lifecycle as every client reads it. A step frame may arrive first as "running" and
// close later on the SAME id as "done", "error" or "withdrawn" (it started, but nothing it did is
// worth showing). Frames from before that lifecycle carry no status at all, and those still mean
// done. One home for both rules, so the operator chat, the portal and Studio cannot drift apart.

export type StepStatus = "running" | "done" | "error" | "withdrawn";

const STEP_STATUSES: ReadonlySet<unknown> = new Set<StepStatus>(["running", "done", "error", "withdrawn"]);

/**
 * The status a step frame carries, as a client should act on it. A missing status means "done"
 * (the shape before the lifecycle). Anything this client does not know — including an explicit
 * null — returns null: the frame is ignored rather than drawn, and never shown as done (§13).
 */
export function normalizeStepStatus(raw: unknown): StepStatus | null {
  const status = raw === undefined ? "done" : raw;
  return STEP_STATUSES.has(status) ? (status as StepStatus) : null;
}

/**
 * The read ended (done, rolled back, failed or stopped) with a step still "running": nothing will
 * ever close it, so it goes — a row that spins forever would say she is still at work. Returns the
 * same array when nothing was open, so a state setter given it re-renders nothing.
 */
export function settleOpenSteps<T extends { status?: unknown }>(steps: T[]): T[] {
  return steps.some((s) => s.status === "running") ? steps.filter((s) => s.status !== "running") : steps;
}
