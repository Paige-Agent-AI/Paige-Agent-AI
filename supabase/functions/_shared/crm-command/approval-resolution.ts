// THE ONE HOME for deciding WHICH already-approved CRM proposal a re-emitted tool call claims (§18).
//
// ── THE DEFECT THIS EXISTS TO END (measured on prod, 2026-09-25) ────────────────────────────────
// `crmApprovalSubject` (catalog.ts) keys update-shaped actions on a STABLE record id (contact_id,
// company_id, deal_id, task_id) but has no such id for a *.create — so it falls back to a hash of
// the WHOLE proposed command. The Chat CRM door then narrowed the operator's approved set with a
// single SQL equality on that subject, computed from the MODEL's re-emitted arguments. On the
// approval turn the model is explicitly told it need not reproduce the arguments byte-for-byte, so
// a create's subject drifted, the lookup returned ZERO rows, and the approval was refused. Every
// refusal made Paige file another proposal, which made the next approval genuinely ambiguous — a
// self-perpetuating wall. Fourteen days of `paige_pending_confirmations` show exactly that split:
// crm_update_contact (identity = contact_id, drift-tolerant) 2 asked / 0 stranded, while
// crm_create_contact 4 asked / 3 stranded and deal_create 2 asked / 2 stranded.
//
// ── WHY RELAXING THE NARROW IS SAFE (§9/§13) ────────────────────────────────────────────────────
// This decides only WHICH of the proposals the human already echoed back is claimed. It can never
// widen the claimable set: the caller hands it rows already restricted by `.in("fingerprint",
// approvedConfirmations)` plus tenant, actor, tool, scope, liveness and server-issue predicates.
// And the claim does not carry the model's arguments into the write — `crm-command` performs an
// atomic compare-and-set on the stored row, reads back its `args`, and executes THAT command
// (crm-command/index.ts claim at ~321-339, execution at ~498-520). Argument drift therefore never
// reaches the database; it could only ever decide which approved call runs, which is what this
// resolver pins.
//
// Extracted as a PURE function so the resolution ORDER — the actual defect — is provable in vitest
// rather than asserted over handler source. Deliberately dependency-free: it is imported by the
// Deno edge handler and by Node tests.

/** One live, already-approved proposal row, exactly as the door selects it. */
export type CrmApprovalCandidate = { fingerprint?: unknown; args?: unknown };

export type CrmApprovalResolution =
  /** Claim this proposal. `matched` says which rule picked it, for logging and for tests. */
  | { kind: "claim"; fingerprint: string; matched: "subject" | "sole" }
  /** The operator approved things, but none of them is a live proposal for THIS tool. */
  | { kind: "none" }
  /** Approvals exist for this tool and more than one could be meant. Refuse; never guess. */
  | { kind: "ambiguous"; reason: "too_many_candidates" | "no_single_candidate" };

/**
 * The most candidates this will reason over. Mirrors the general confirm gate's bound: the door
 * selects one more than this so an over-large set is detectable, and an over-large set refuses
 * rather than being silently truncated into a wrong pick.
 */
export const CRM_APPROVAL_CANDIDATE_LIMIT = 16;

const FINGERPRINT = /^[0-9a-f]{16}$/;

/**
 * The subject crm-command STORED with the proposal. Read, never recomputed: for the preview-bound
 * actions crm-command rewrites the stored args to `{ command: { action, preview_id }, … }`, so
 * recomputing a subject from those args would produce a value that never equals the one computed
 * from a full command and would strand every preview-bound approval. The stored string is the
 * subject of the exact command the operator was shown.
 */
function storedSubject(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const subject = (args as Record<string, unknown>).approval_subject;
  return typeof subject === "string" && subject !== "" ? subject : null;
}

/**
 * Pick the one approved proposal this call claims, in a fixed order:
 *
 *  1. More candidates than the bound → ambiguous. Refuse rather than reason over an unbounded set.
 *  2. A malformed candidate → ambiguous. Fail closed; never drop a row and let the remainder look
 *     unambiguous. (Unreachable from the door's own query; kept so it cannot become reachable.)
 *  3. No live approved proposal for this tool → `none`. Nothing is claimed and nothing is refused:
 *     the operator's approvals were for something else, so this call is an ordinary unapproved one
 *     and must still get its own card.
 *  4. EXACTLY ONE candidate whose STORED subject equals this call's subject → claim it. This is the
 *     precise, drift-free path and it keeps today's behaviour whenever the model did reproduce the
 *     command.
 *  5. No subject match, EXACTLY ONE live approved candidate, AND exactly one call for this tool in
 *     this turn → claim it. The person approved one thing for this tool; model drift must not
 *     defeat it, and the stored call is what executes. The turn-count condition is load-bearing:
 *     with two same-tool calls there is no basis for choosing, so it falls through to ambiguous.
 *  6. Anything else — two or more candidates with no single subject match → ambiguous. Refuse
 *     honestly; do not guess which one the person meant.
 */
export function resolveCrmApprovedFingerprint(
  candidates: readonly CrmApprovalCandidate[],
  approvalSubject: string,
  /**
   * How many calls for THIS capability the model emitted in this turn. The sole-candidate rule
   * (5) is only sound when it is 1 — see the rule's own note. Defaults to 1 so an omitted
   * argument can never silently widen; callers that know better pass the real count.
   */
  sameToolCallsThisTurn = 1,
): CrmApprovalResolution {
  if (candidates.length > CRM_APPROVAL_CANDIDATE_LIMIT) {
    return { kind: "ambiguous", reason: "too_many_candidates" };
  }
  const live: Array<{ fingerprint: string; subject: string | null }> = [];
  for (const row of candidates) {
    if (typeof row?.fingerprint !== "string" || !FINGERPRINT.test(row.fingerprint)) {
      return { kind: "ambiguous", reason: "no_single_candidate" };
    }
    live.push({ fingerprint: row.fingerprint, subject: storedSubject(row.args) });
  }
  if (live.length === 0) return { kind: "none" };

  const subject = typeof approvalSubject === "string" && approvalSubject !== "" ? approvalSubject : null;
  const exact = subject === null ? [] : live.filter((row) => row.subject === subject);
  if (exact.length === 1) return { kind: "claim", fingerprint: exact[0].fingerprint, matched: "subject" };
  // Rule 5 is sound ONLY when this turn holds a single call for this capability. With two, the
  // resolver cannot tell which one the operator approved, and "the only live approval" is not an
  // answer to that — it is a coin toss. The peer-gate proved the failure end-to-end: approve
  // "create John", ask for Jane in the same turn, and Jane's call (dispatched first) claims John's
  // fingerprint. The WRITE stays safe, because the stored args execute — but John's readback
  // returns under Jane's tool_call_id, so Paige narrates a record the operator did not get, Jane
  // never happens, and John's approval is burned. That is precisely the "Locked in" lie this
  // change exists to end, so it must not be reintroduced by the fix for it.
  if (exact.length === 0 && live.length === 1 && sameToolCallsThisTurn === 1) {
    return { kind: "claim", fingerprint: live[0].fingerprint, matched: "sole" };
  }
  return { kind: "ambiguous", reason: "no_single_candidate" };
}
