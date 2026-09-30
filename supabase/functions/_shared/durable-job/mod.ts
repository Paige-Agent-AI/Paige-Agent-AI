/**
 * Paige Durable Job Contract — shared seam module.
 *
 * Implements `docs/brain/paige-durable-job-contract.md` (PROPOSAL adopted 2026-09-10),
 * which extends the Paige Runtime Harness doctrine in
 * `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §3 responsibility #5 (durable work).
 *
 * TWO-LAYER RULE. This module governs machine execution ATTEMPTS, never business
 * workflow. A business row (e.g. `paige_actions.status`) keeps its own lifecycle; it
 * rides this contract only through its execution attempts. Nothing here replaces or
 * renames a business lifecycle.
 *
 * SCOPE OF MECHANICS. The seam owns canonical states, lease math, idempotency-window
 * math, and receipt correlation. Migration `20270417000000_paige_durable_work_envelope`
 * supplies the ONE cross-capability work-identity table and its server-only transition seam.
 * Capability-specific substrates keep their own business/run schemas and reference that
 * envelope through `work_id`; none may create a second universal job table or scheduler.
 *
 * HONEST STATES (CLAUDE.md §13). `succeeded` requires a verified canonical write. A
 * lost lease is `expired`, which routes to reconciliation — never blind retry. An
 * ambiguous effect is `outcome_unknown` and MUST reconcile before any retry. "Done" is
 * never claimed from a hope.
 *
 * This module is deliberately dependency-free (no `npm:` / Deno globals) so vitest can
 * import it directly, the same way `_shared/paige-spine/registry.ts` is exercised.
 */

/**
 * Canonical execution states. Substrate adapters project their native status onto
 * exactly these; no native status may bypass the projection.
 */
export const DURABLE_JOB_STATES = [
  "claimed",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "expired",
  "outcome_unknown",
] as const;

export type DurableJobState = (typeof DURABLE_JOB_STATES)[number];

/** States from which no further attempt may be dispatched. */
export const TERMINAL_STATES: readonly DurableJobState[] = [
  "succeeded",
  "failed",
  "cancelled",
] as const;

/**
 * States that owe reconciliation before anything else may happen to the job.
 * `expired` — the lease died; find out what the worker did (or didn't) do.
 * `outcome_unknown` — the effect may have landed; reconcile, never blind-retry.
 */
export const RECONCILIATION_STATES: readonly DurableJobState[] = [
  "expired",
  "outcome_unknown",
] as const;

export function isTerminal(state: DurableJobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function needsReconciliation(state: DurableJobState): boolean {
  return RECONCILIATION_STATES.includes(state);
}

/**
 * Deterministic idempotency key per unit of work: the same key can never produce two
 * side effects. `intent` buckets recurring work (e.g. the ISO week for a weekly send);
 * one-shot work uses a fixed intent such as `"once"`.
 */
export function idempotencyKey(substrate: string, rowId: string, intent: string): string {
  return `${substrate}:${rowId}:${intent}`;
}

/**
 * True while `lastCompletedAt` still covers `intent`'s idempotency window. A job that
 * completed inside the window is never re-dispatched for the same intent, so a manual
 * re-fire or a post-timeout scheduler retry cannot double-send.
 *
 * `windowStart` is the instant the current intent's window opens (for a weekly intent,
 * the week's start): a completion at or after `windowStart` covers this intent.
 */
export function completedForIntent(
  lastCompletedAt: string | Date | null | undefined,
  windowStart: Date,
): boolean {
  if (!lastCompletedAt) return false;
  const completed = typeof lastCompletedAt === "string" ? new Date(lastCompletedAt) : lastCompletedAt;
  if (Number.isNaN(completed.getTime())) return false;
  return completed.getTime() >= windowStart.getTime();
}

/**
 * True when a claim's lease has died. Expired claims route to reconciliation
 * (`needsReconciliation`), never to immediate re-dispatch — the worker may have
 * delivered its effect after the lease holder stopped watching.
 */
export function leaseExpired(
  claimedAt: string | Date | null | undefined,
  now: Date,
  ttlMs: number,
): boolean {
  if (!claimedAt) return true;
  const claimed = typeof claimedAt === "string" ? new Date(claimedAt) : claimedAt;
  if (Number.isNaN(claimed.getTime())) return true;
  return now.getTime() - claimed.getTime() >= ttlMs;
}

/**
 * Monday 00:00 UTC of the week containing `now` — the intent bucket the weekly-summary
 * substrate uses. Kept here so the SQL claim RPC and any worker-side check agree on
 * bucket boundaries by construction.
 */
export function weeklyIntentBucket(now: Date): string {
  const day = now.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const mondayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)),
  );
  return mondayUtc.toISOString().slice(0, 10);
}

/**
 * Maps a substrate terminal/`outcome_unknown` state onto the Rail's capability-run
 * vocabulary (`_shared/capability-record.ts`) for receipt correlation. Non-recording
 * states (`claimed`, `blocked`) return null — the contract records on terminal and
 * `outcome_unknown` transitions only.
 */
export function capabilityOutcomeFor(
  state: DurableJobState,
): "capability_succeeded" | "capability_failed" | "capability_outcome_unknown" | null {
  switch (state) {
    case "succeeded":
      return "capability_succeeded";
    case "failed":
    case "cancelled":
      return "capability_failed";
    case "expired":
    case "outcome_unknown":
      return "capability_outcome_unknown";
    default:
      return null;
  }
}

/** Guardrail constants defaults for the first adopter; substrates may tighten, not loosen silently. */
export const DURABLE_JOB_DEFAULTS = {
  /** Lease TTL for cron-claimed sends. Matches the comms drainer's 5-minute precedent. */
  leaseTtlMs: 5 * 60 * 1000,
  /** Attempts per idempotency intent before the job reads `failed` for that intent. */
  maxAttemptsPerIntent: 5,
} as const;
