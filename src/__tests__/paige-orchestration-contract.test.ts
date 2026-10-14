/**
 * Layer C · C4 — the reusable, connector-neutral ActionAdapter CONTRACT conformance suite
 * (`_shared/paige-orchestration/adapters.ts`).
 *
 * C1 built the ledger + monotonic RPC, C2 the native adapter, C3 the n8n adapter. C4 LOCKS the reusable
 * contract itself: the promise that "the engine, the ledger, and the governed pathway never change — every
 * new connector plugs in by REGISTERING an adapter" (owner directive: connector-neutral). These invariants
 * are proven UNIFORMLY across EVERY registered adapter, so adapter #3 (Zapier / Slack / Teams / Google …)
 * cannot silently violate the contract:
 *
 *   1. KIND RESOLUTION round-trips — an adapter's own action_kind resolves to its kind; an unknown kind is
 *      "unsupported" and `adapterForAction` FAILS CLOSED to null (never a silent success — §13).
 *   2. resolveCapability is EXACT — non-null for a kind the adapter owns (valid effect; a mutation carries a
 *      non-empty outcome channel), and null for a foreign kind (an adapter never claims a kind it does not own).
 *   3. ONE LEDGER — every adapter's mutation names the SAME governed channel, `paige_act_executions` (C4's
 *      "one paige_act_executions ledger" requirement, proven at the contract seam, not by convention).
 *   4. STATE SEMANTICS — the DispatchResult.outcome union is a SUBSET of the canonical outcome vocabulary, so
 *      no adapter can ever return an outcome the ledger domain would reject at write time.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAdapterKind,
  adapterForAction,
  getAdapter,
  registeredAdapterKinds,
  type DispatchResult,
} from "../../supabase/functions/_shared/paige-orchestration/adapters.ts";
import { ACT_OUTCOME_SET } from "../../supabase/functions/_shared/paige-orchestration/outcomes.ts";

// The registered adapters, each with a representative action_kind it OWNS, one it must DISOWN, the effect its
// capability declares, and the exact capability id (the underscore action-risk key — which, for native, is
// deliberately NOT equal to the dotted action_kind: the standard dotted-kind ↔ underscore-tool seam).
const REGISTERED: ReadonlyArray<{
  kind: string; own: string; foreign: string; effect: "read" | "mutate"; capId: string;
  lostClaimRecovery: "readback_proves_absence" | "outcome_unknown";
}> = [
  { kind: "native", own: "crm.advance_journey_stage", foreign: "n8n_run_workflow", effect: "mutate", capId: "crm_advance_journey_stage", lostClaimRecovery: "readback_proves_absence" },
  { kind: "n8n", own: "n8n_run_workflow", foreign: "crm.advance_journey_stage", effect: "mutate", capId: "n8n_run_workflow", lostClaimRecovery: "outcome_unknown" },
];

describe.each(REGISTERED)("ActionAdapter contract conformance — the $kind adapter", (row) => {
  it("kind resolution round-trips: the owned action_kind resolves to this adapter's kind", () => {
    expect(resolveAdapterKind(row.own)).toBe(row.kind);
    const adapter = getAdapter(row.kind);
    expect(adapter, `no adapter registered for kind ${row.kind}`).toBeTruthy();
    expect(adapter?.kind).toBe(row.kind);
    // adapterForAction (kind resolution + registry lookup) lands on the SAME registered adapter.
    expect(adapterForAction(row.own)).toBe(adapter);
  });

  it("resolveCapability is EXACT: non-null (correct effect + one-ledger channel) for the owned kind", () => {
    const cap = getAdapter(row.kind)!.resolveCapability(row.own);
    expect(cap, `${row.kind} must own ${row.own}`).not.toBeNull();
    expect(cap!.id).toBe(row.capId);
    expect(cap!.effect).toBe(row.effect);
    // §BRAIN "one home": every mutation routes its outcome through the ONE ledger, never a per-adapter channel.
    if (cap!.effect === "mutate") expect(cap!.outcomeChannel).toBe("paige_act_executions");
  });

  it("resolveCapability DISOWNS a foreign action_kind (never claims a kind it does not own) → null", () => {
    expect(getAdapter(row.kind)!.resolveCapability(row.foreign)).toBeNull();
  });

  it("declares what a lost dispatch claim means (Slice 2b): only an authoritative readback may re-take one", () => {
    expect(getAdapter(row.kind)!.lostClaimRecovery).toBe(row.lostClaimRecovery);
  });

  it("declares dispatch + readback (the async two-phase contract every registered adapter implements)", () => {
    const adapter = getAdapter(row.kind)!;
    expect(typeof adapter.dispatch).toBe("function");
    expect(typeof adapter.readback).toBe("function");
  });
});

describe("ActionAdapter contract — the conformance table covers EVERY registered adapter (self-enforcing)", () => {
  it("REGISTERED names every kind in the live registry — a new adapter fails this until it is covered", () => {
    // Mechanizes the connector-neutral promise: adding adapter #3 to the registry without a REGISTERED row
    // breaks this assertion, so no adapter can escape the contract suite by omission (§18/§13).
    const covered = new Set(REGISTERED.map((r) => r.kind));
    const registered = new Set(registeredAdapterKinds());
    expect([...covered].sort()).toEqual([...registered].sort());
  });
});

describe("ActionAdapter contract — FAIL CLOSED on an unsupported kind (never a silent success, §13)", () => {
  it("an unknown action_kind resolves to 'unsupported' and adapterForAction returns null", () => {
    for (const unknown of ["frobnicate_thing", "totally_unknown", "", "  ", null, undefined]) {
      expect(resolveAdapterKind(unknown as string), `kind for ${JSON.stringify(unknown)}`).toBe("unsupported");
      expect(adapterForAction(unknown as string), `adapter for ${JSON.stringify(unknown)}`).toBeNull();
    }
  });
  it("no adapter is registered under the 'unsupported' kind (the engine records failed/unsupported_adapter)", () => {
    expect(getAdapter("unsupported")).toBeNull();
  });
});

describe("ActionAdapter contract — DispatchResult.outcome ⊆ the canonical outcome vocabulary (state semantics)", () => {
  it("every outcome an adapter may return is a real ledger vocabulary member (never a domain-rejected value)", () => {
    // A Record keyed by the union enforces EXHAUSTIVENESS at compile time: if DispatchResult.outcome ever gains
    // a member, this object literal fails tsc until the new key is added here (a bare `Union[]` array would
    // NOT — it only checks assignability, not coverage). Its keys are then the complete set of outcomes an
    // adapter can return, and every one must be in the ledger's outcome domain — so an adapter can never hand
    // the RPC an outcome its CHECK constraint would reject at write time.
    const DISPATCH_OUTCOME_KEYS: Record<DispatchResult["outcome"], true> = {
      accepted_for_execution: true, retrying: true, executed: true, failed: true, ambiguous: true, cancelled: true,
    };
    for (const o of Object.keys(DISPATCH_OUTCOME_KEYS)) {
      expect(ACT_OUTCOME_SET.has(o), `DispatchResult outcome '${o}' must be a paige_act_outcome value`).toBe(true);
    }
  });
});
