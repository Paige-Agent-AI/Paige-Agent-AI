// INT-179 Slice 2b — the ONE at-most-once dispatch gate for a Layer-C act.
//
// Both callers that fire an act — the engine (phase 5) and the approval executor — take this claim
// immediately before dispatching. `paige_claim_act_dispatch` (20271023000000) is a single guarded UPDATE that
// stamps `detail.dispatch_claim` only when no live claim exists, so of any number of concurrent callers exactly
// one is told `claimed: true`. Everyone else must NOT dispatch: the act stays accepted_for_execution and is
// picked up by the normal reconcile path. A claim older than the RPC's stale window may be re-taken, so a
// caller re-claims only after its own readback has shown the earlier dispatch did not land.

type ClaimDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** How long a claim protects a dispatch before another caller may re-take it (the RPC floors it at 7 minutes,
 *  above the edge-function wall-clock cap). The approval refusal copy ("ten minutes") is tied to this value. */
export const DISPATCH_CLAIM_STALE = "10 minutes";

/** `ok:false` = the claim could not be read or written (infra) — dispatch nothing and retry later.
 *  `ok:true, claimed:false` = another caller holds the dispatch, or the act is not dispatchable. */
export type DispatchClaim = { ok: boolean; claimed: boolean };

export async function claimActDispatch(db: ClaimDb, eventId: string, actId: string): Promise<DispatchClaim> {
  let res: { data: unknown; error: unknown };
  try {
    res = await db.rpc("paige_claim_act_dispatch", {
      _event_id: eventId, _act_id: actId, _claim: crypto.randomUUID(), _stale_after: DISPATCH_CLAIM_STALE,
    });
  } catch {
    return { ok: false, claimed: false };
  }
  if (res.error) return { ok: false, claimed: false };
  // The RPC returns the claimed row, or NULL (PostgREST may surface a NULL composite as null or as an all-null
  // object) — only a row with an id is a claim.
  const id = (res.data as { id?: unknown } | null)?.id;
  return { ok: true, claimed: typeof id === "string" && id.length > 0 };
}
