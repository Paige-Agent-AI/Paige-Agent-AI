// INT-179 Slice 2b — the ONE at-most-once dispatch seam for a Layer-C act.
//
// Every caller that fires an act — the engine (phase 5) and the approval executor — dispatches ONLY through
// `dispatchUnderClaim`. It takes the claim (`paige_claim_act_dispatch`, a single guarded UPDATE that stamps
// `detail.dispatch_claim` only when no live claim exists, so of any number of concurrent callers exactly one is
// told `claimed: true`), and only then calls the adapter. Everyone else dispatches nothing: the act stays
// accepted_for_execution and is picked up again by the normal drain or the reconciler's recovery pass.
//
// A claim older than the RPC's stale window belongs to a dispatcher that died. Whether it may be taken over is the
// ADAPTER's declaration (`lostClaimRecovery`): an adapter whose readback proves absence may re-take it (callers
// re-dispatch only after that readback found nothing); any other adapter may claim an act nobody ever claimed but
// never a lost claim, because the dead holder may already have fired — that act is left for the reconciler to
// record ambiguous, never replayed.

import type { ActionAdapter, DispatchInput, DispatchResult } from "./adapters.ts";

type ClaimDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** How long a claim protects a dispatch before another caller may re-take it (the RPC floors it at 7 minutes,
 *  above the edge-function wall-clock cap). Tied to this value: the approval refusal copy ("ten minutes"), and the
 *  reconciler's claim-liveness window in paige_reconcile_orchestration_acts (a drift test pins the migration). */
export const DISPATCH_CLAIM_STALE = "10 minutes";

/** `ok:false` = the claim could not be read or written (infra) — dispatch nothing and retry later.
 *  `ok:true, claimed:false` = another caller holds the dispatch, the act is not dispatchable, or a lost claim this
 *  adapter may not take over. */
export type DispatchClaim = { ok: boolean; claimed: boolean };

export async function claimActDispatch(
  db: ClaimDb, eventId: string, actId: string, opts: { allowRetake?: boolean } = {},
): Promise<DispatchClaim> {
  let res: { data: unknown; error: unknown };
  try {
    res = await db.rpc("paige_claim_act_dispatch", {
      _event_id: eventId, _act_id: actId, _claim: crypto.randomUUID(), _stale_after: DISPATCH_CLAIM_STALE,
      _allow_retake: opts.allowRetake ?? true,
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

/** The result of a dispatch attempt through the seam. `claim_error`, `held` and `not_dispatchable` dispatched NOTHING.
 *  `not_dispatchable` = the adapter has no dispatch at all (callers check first today; distinct so a caller never
 *  tells the owner "it may already be running" about an act that cannot run). */
export type ClaimedDispatch =
  | { kind: "claim_error" }
  | { kind: "held" }
  | { kind: "not_dispatchable" }
  | { kind: "dispatched"; result: DispatchResult };

/** A dispatch that THREW is unconfirmed, never failed and never executed: the call may have gone out. */
export function ambiguousFromThrow(e: unknown, reason: string): DispatchResult {
  return { outcome: "ambiguous", providerRef: null, detail: { reason }, error: e instanceof Error ? e.message : String(e) };
}

/** Claim the act, then dispatch it through its adapter — the only sanctioned way to fire a Layer-C act. */
export async function dispatchUnderClaim(
  db: ClaimDb, eventId: string, actId: string,
  adapter: Pick<ActionAdapter, "dispatch" | "lostClaimRecovery">, input: DispatchInput,
): Promise<ClaimedDispatch> {
  if (typeof adapter.dispatch !== "function") return { kind: "not_dispatchable" };
  const claim = await claimActDispatch(db, eventId, actId, {
    allowRetake: adapter.lostClaimRecovery === "readback_proves_absence",
  });
  if (!claim.ok) return { kind: "claim_error" };
  if (!claim.claimed) return { kind: "held" };
  let result: DispatchResult;
  try { result = await adapter.dispatch({ ...input, eventId, actId }); } catch (e) { result = ambiguousFromThrow(e, "adapter_threw"); }
  return { kind: "dispatched", result };
}
