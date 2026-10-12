// Paige Runtime Harness — Layer C · C4: the ONE canonical home for the per-act outcome vocabulary and the
// FINAL/SETTLED state set (§18 — one home per capability).
//
// WHY THIS FILE EXISTS. The "exact state semantics" the owner requires (MESSAGE B item 3) were, until C4,
// duplicated across FOUR hand-maintained copies with no drift guard between them:
//   1. decide.ts `ActOutcome` — the TS outcome union.
//   2. the SQL domain `public.paige_act_outcome` CHECK (migration 20270126000000).
//   3. engine.ts `FINAL_OR_SETTLED` — the TS "a final row is never re-dispatched" set.
//   4. the SQL `_final` array inside `paige_record_act_execution` (same migration).
// A drift between (1)/(2) or (3)/(4) is a SILENT correctness bug of exactly the class C4 names: if a state is
// FINAL in the RPC but advanceable in the engine, phase 5 reconciles a row the RPC refuses to update (a
// phantom "still reconciling" that can never settle); if it is advanceable in the RPC but FINAL in the engine,
// the engine treats a genuinely in-flight row as done and drops the reconcile.
//
// C4 collapses the TS side to ONE definition here; `decide.ts` and `engine.ts` DERIVE from it. The SQL side
// stays authoritative in its already-shipped migration (never re-written — it is live on prod), and a
// BIDIRECTIONAL drift guard (paige-orchestration-decide.test.ts) parses that migration and asserts the SQL
// domain == ACT_OUTCOMES and the SQL `_final` == FINAL_OUTCOMES, set-for-set, both directions. That mechanical
// pin is the same pattern as the F5 registry-sync guard — a two-source invariant locked by a test, not by a
// human remembering to edit two files (§13/§32). If the SQL domain or `_final` set is ever changed by a NEW
// migration, this canonical TS + the guard move with it in the SAME commit (§66/§BRAIN.3).
//
// PURE by construction — no I/O, no imports, so any adapter, the engine, the decision core, and the tests all
// share ONE vocabulary without a dependency cycle.

/** The exact per-act outcome vocabulary — the single source of truth for the TS side. Mirrors the SQL domain
 *  `public.paige_act_outcome` (migration 20270126000000), pinned set-for-set by the drift guard. */
export const ACT_OUTCOMES = [
  // evaluated but did not run, and why:
  "condition_not_matched",   // the automation's conditions excluded this event
  "held_by_lane",            // effective autonomy lane 'off' (or the process is paused) — not run
  "approval_pending",        // effective lane 'confirm' — a proposal was minted; awaiting a human yes
  "refused_authority",       // refused on identity/tenant/access/role/door
  "refused_budget",          // refused by a budget/spend cap
  "refused_trust_compass",   // refused by the Trust-Compass ceiling / §68 authority decay
  "refused_consent",         // refused by a consent/quiet-hours/communication limit
  // authorized and in flight:
  "accepted_for_execution",  // authorized + durably recorded; dispatch to the adapter is next
  "retrying",                // dispatched but not yet terminal; a retry/poll is pending
  // terminal:
  "executed",                // executed and read back with a confirmed provider outcome
  "failed",                  // the adapter/provider reported a failure
  "ambiguous",               // fired but the outcome could not be confirmed either way (§13 honest)
  "cancelled",               // cancelled before or during execution
] as const;

/** The exact per-act outcome type — derived from the one vocabulary above (no hand-typed union). */
export type ActOutcome = typeof ACT_OUTCOMES[number];

/**
 * The FINAL/SETTLED outcomes — the single source of truth for the TS side of the monotonic guard. Once a row
 * holds one of these, a re-drain or retry NEVER overwrites it and phase 5 adopts it (idempotency across
 * re-drains). Mirrors the SQL `_final` array in `paige_record_act_execution` (migration 20270126000000),
 * pinned set-for-set by the drift guard.
 *   • executed / failed / cancelled are terminal.
 *   • the decision outcomes (condition_not_matched, held_by_lane, approval_pending, refused_*) are SETTLED
 *     decisions a re-drain must re-derive identically and must not flip.
 * `satisfies readonly ActOutcome[]` is a COMPILE-TIME proof that every member is a real ActOutcome (so a typo
 * or a stale member cannot slip in) while keeping the narrow literal tuple type for the drift guard to iterate.
 */
export const FINAL_OUTCOMES = [
  "condition_not_matched",
  "held_by_lane",
  "approval_pending",
  "refused_authority",
  "refused_budget",
  "refused_trust_compass",
  "refused_consent",
  "executed",
  "failed",
  "cancelled",
] as const satisfies readonly ActOutcome[];

/** The ONLY advanceable states (the dispatch/reconcile paths) — DERIVED as the vocabulary minus the final set,
 *  so "advanceable" can never drift from "final" (they are two views of one partition). Today this resolves to
 *  exactly [accepted_for_execution, retrying, ambiguous]. */
export const ADVANCEABLE_OUTCOMES: readonly ActOutcome[] =
  ACT_OUTCOMES.filter((o) => !(FINAL_OUTCOMES as readonly string[]).includes(o));

/** Set forms for O(1) membership (string-keyed so callers can test a raw DB value without a cast). */
export const ACT_OUTCOME_SET: ReadonlySet<string> = new Set(ACT_OUTCOMES);
export const FINAL_OUTCOME_SET: ReadonlySet<string> = new Set<string>(FINAL_OUTCOMES);

/** The ONE run-id seed for a Layer-C act's capability receipt, shared by the engine's auto path and the
 *  approval executor so an act has at most one receipt whichever path files it (record_capability_run folds
 *  a repeat of the same run id). Pass it to `stableRunId`. */
export function actReceiptRunSeed(eventId: string, actId: string): string[] {
  return ["paige-cap", eventId, actId];
}

/** True when a persisted outcome is FINAL/SETTLED (never re-dispatched). Accepts a raw string so an
 *  already-persisted DB value can be tested directly. */
export function isFinalOutcome(outcome: string | null | undefined): boolean {
  return outcome != null && FINAL_OUTCOME_SET.has(outcome);
}
