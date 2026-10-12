// Paige Runtime Harness — Layer C: the CONNECTOR-NEUTRAL action-adapter contract + registry.
//
// An act (`paige_automation_acts`) names an `action_kind`. The engine resolves it to (a) an adapter KIND
// (which governed connector carries it) and (b) the governed CAPABILITY it must be decided as — then
// governs EVERY kind through the one `decideGovernedExecution` pathway, and (slice 2) dispatches through
// the adapter and reads the outcome back. n8n is the FIRST adapter; Zapier · Make · Google · M365/Teams ·
// Slack · Telegram · direct-CRM · native-Paige · specialist-job all plug in by REGISTERING an adapter —
// the engine, the ledger, and the governed pathway never change (owner directive: connector-neutral, "do
// not build an n8n-specific engine or a second action/receipt system").
//
// This file is the PURE contract + registry + kind/capability resolution — unit-provable. The actual
// dispatch/readback is implemented PER ADAPTER (a native adapter's I/O is dependency-injected via
// DispatchInput.db, so this module imports no client and stays testable). C2 implements the NATIVE adapter
// (native-adapter.ts — the synchronous in-tenant executor). n8n's dispatch/readback land in C3 (reusing
// paige-n8n's run/execution_get via a shared seam — never a forked n8n client), still contract-stable here.

import { isNativeActionKind, nativeAdapter } from "./native-adapter.ts";
import { n8nExecuteAdapter } from "./n8n-adapter.ts";

export type AdapterKind = "n8n" | "native" | "unsupported" | (string & {});

/** The governed capability an act is decided as (fed to decideGovernedExecution's `capability`). NOTE: an
 *  adapter NEVER declares availability here (owner correction, 2026-09-13). Availability is resolved by the
 *  engine THROUGH the canonical Gateway seam (paige-capability-status) and passed to buildGovernedInputs —
 *  a Layer-C availability literal is the forbidden fallback rule. */
export type AdapterCapability = {
  /** canonical action-risk key (the act's action_kind slug is that key). */
  id: string;
  effect: "read" | "mutate";
  /** required for a mutation — decideGovernedExecution enforces a non-empty channel on mutate. */
  outcomeChannel?: string;
};

/** The minimal supabase-js surface a native adapter's dispatch/readback needs (RPC + a read chain). Kept
 *  structural so the engine's service-role client assigns without importing the SDK type, and a fake db
 *  makes the native path unit-provable without a live database. */
export type AdapterDb = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

/** Context the engine hands an adapter to dispatch a governed act (C2). */
export type DispatchInput = {
  tenantId: string;
  actionKind: string;
  /** the arguments decideGovernedExecution returned on the `execute` branch (never the raw model args). */
  args: unknown;
  /** the durable correlation id Paige minted BEFORE dispatch (== the ledger idempotency_key). */
  correlationRef: string;
  /** service-role client for a native in-tenant write/readback (C2). Absent for a pure-contract call. */
  db: AdapterDb;
  /** the event's canonical subject coordinates — the subject IS the target (a contact id is never an arg). */
  subjectTable: string;
  subjectId: string;
};

/** The connector-neutral result of a dispatch or a readback. `outcome` is the exact per-act outcome the
 *  ledger records; `providerRef` is the provider's own execution/correlation id once known. */
export type DispatchResult = {
  outcome: "accepted_for_execution" | "retrying" | "executed" | "failed" | "ambiguous" | "cancelled";
  providerRef?: string | null;
  detail?: Record<string, unknown>;
  error?: string | null;
};

/** What a LOST dispatch claim means for an adapter (Slice 2b crash recovery). A dispatcher can die after claiming
 *  an act and before recording what its dispatch did; the act is then accepted with a stale claim.
 *    * "readback_proves_absence" — the adapter's readback is authoritative: when it finds nothing, the effect never
 *      happened, so the act may be dispatched again under a fresh claim (native: the correlation-stamped write).
 *    * "outcome_unknown" — a readback cannot prove the effect did not happen (an external call may have gone out
 *      before the crash), so a lost claim is NEVER taken over: the act is recorded ambiguous and not replayed. */
export type LostClaimRecovery = "readback_proves_absence" | "outcome_unknown";

export interface ActionAdapter {
  kind: AdapterKind;
  /** Required for every adapter, so a new one cannot reach dispatch without declaring it. */
  lostClaimRecovery: LostClaimRecovery;
  /** Map an act's action_kind to the governed capability. Pure. Returns null if this adapter does not
   *  own the action_kind (the engine then fails closed as unsupported). */
  resolveCapability(actionKind: string): AdapterCapability | null;
  /** perform the action. Declared here so the contract is stable across adapters (native: C2; n8n: C3+). */
  dispatch?(input: DispatchInput): Promise<DispatchResult>;
  /** confirm a prior dispatch WITHOUT re-performing it — the canonical readback/reconcile. `providerRef` is
   *  null for a synchronous native reconcile (it re-reads by the act's own correlation), a provider id for
   *  an async provider (C3+). */
  readback?(providerRef: string | null, input: DispatchInput): Promise<DispatchResult>;
}

// ── Kind resolution: action_kind → adapter kind. Prefix-based for the first roster; a DB-backed mapping
//    (config-as-data, §10) can replace this later without touching callers. Unknown → "unsupported". ────
const KIND_PREFIXES: ReadonlyArray<readonly [string, AdapterKind]> = [
  ["n8n", "n8n"],
  ["native_", "native"],
  ["paige_", "native"],
];

export function resolveAdapterKind(actionKind: string | null | undefined): AdapterKind {
  if (!actionKind) return "unsupported";
  // A registered native executor wins first (e.g. `crm_advance_journey_stage`, which carries no native
  // prefix). Then the prefix roster; unknown → "unsupported" (fail closed — never a silent success).
  if (isNativeActionKind(actionKind)) return "native";
  for (const [prefix, kind] of KIND_PREFIXES) {
    if (actionKind === prefix || actionKind.startsWith(prefix)) return kind;
  }
  return "unsupported";
}

// ── The registry. n8n is the first registered adapter. Every unregistered kind resolves to null →
//    the engine records a fail-closed outcome (an unsupported adapter never silently "succeeds"). ───────

/** The n8n workflow-runtime adapter (Route A). resolveCapability treats any n8n action_kind as a MUTATION
 *  (running a workflow is an external effect); the capability id is the action_kind slug itself (which is
 *  the canonical action-risk key). dispatch/readback land in slice 2 over the shared n8n run seam. */
const n8nAdapter: ActionAdapter = {
  kind: "n8n",
  // A fired webhook cannot be proved absent by a poll (no execution id is bound until the fire returns), so a
  // dispatcher that died after claiming may already have run the workflow: never take that claim over.
  lostClaimRecovery: "outcome_unknown",
  resolveCapability(actionKind: string): AdapterCapability | null {
    if (resolveAdapterKind(actionKind) !== "n8n") return null;
    return { id: actionKind, effect: "mutate", outcomeChannel: "paige_act_executions" };
  },
  // C3: dispatch/readback drive the SHARED paige-n8n run/execution_get seam (never a forked client, §18).
  // ASYNC by construction — dispatch fires + returns accepted_for_execution + the execution id; readback
  // POLLS the execution (n8n has no completion callback). HIGH-risk governance is UNCHANGED: in the auto
  // drainer an n8n act clamps to approval_pending and this dispatch is never reached; it fires only for an
  // approved `execute` decision.
  dispatch: n8nExecuteAdapter.dispatch,
  readback: n8nExecuteAdapter.readback,
};

const REGISTRY: ReadonlyMap<AdapterKind, ActionAdapter> = new Map<AdapterKind, ActionAdapter>([
  ["n8n", n8nAdapter],
  // C2: the native synchronous executor (crm_advance_journey_stage → set_journey_stage). Its dispatch is
  // an in-tenant governed write that RETURNS the terminal outcome (executed|failed|ambiguous) directly.
  ["native", nativeAdapter],
]);

/** Resolve the adapter for an adapter kind, or null when no governed adapter is registered for it. */
export function getAdapter(kind: AdapterKind): ActionAdapter | null {
  return REGISTRY.get(kind) ?? null;
}

/** The kinds that actually have a registered adapter. Exposed so the C4 contract-conformance suite can assert
 *  its coverage table names EVERY registered adapter — a newly-registered kind then fails the suite until it
 *  is covered, mechanizing the connector-neutral promise (no adapter escapes the contract by omission). */
export function registeredAdapterKinds(): AdapterKind[] {
  return [...REGISTRY.keys()];
}

/** Resolve the adapter for an act's action_kind directly (kind resolution + registry lookup). */
export function adapterForAction(actionKind: string | null | undefined): ActionAdapter | null {
  return getAdapter(resolveAdapterKind(actionKind));
}
