// Paige Runtime Harness — Layer C · C2: the NATIVE synchronous executor(s).
//
// A "native" action uses a governed IN-TENANT canonical RPC — no external provider or connection.
// The original C2 write advances a
// contact's journey stage (`crm.advance_journey_stage` action_kind → the tenant-aware `set_journey_stage`
// RPC). The native ActionAdapter (registered in adapters.ts) routes an action_kind to its executor here, so
// Experience 05 adds the owner-personal Planning observation using that same registry and claim seam;
// its atomic observation/receipt readback does not mutate Planning. Adding an action is a registry entry,
// never a journey-specific engine (owner:
// connector-neutral).
//
// The contract this honours (adapters.ts): dispatch performs the effect and RETURNS THE TERMINAL OUTCOME
// for a synchronous action (executed | failed | ambiguous); readback is the standalone CORRELATION reconcile
// (exposed for the contract and unit-testing; dispatch calls the same helper inline after a change).
//
// HONESTY & SAFETY invariants (§13/§32 + owner C2 corrections, 2026-09-13):
//   * executed is returned ONLY after OUR OWN write is CONFIRMED to have landed — proven by a transition row
//     the RPC stamped with THIS act's correlation ref (§32). A write's own "ok" is never proof by itself.
//   * confirmation is BY CORRELATION, NOT by the contact's current slug. A bare "current slug == target"
//     check false-confirms when a CONCURRENT act moved the contact to the same stage under a different
//     correlation — OUR write may never have landed. Only a transition stamped with OUR correlationRef
//     proves OUR act's effect, independent of any later concurrent move (§39 F3).
//   * a no-op (already on target) IS the confirmed desired state → executed, reported HONESTLY as
//     `already_at_requested_stage` (NEVER a newly advanced journey). No transition row is written (idempotent).
//   * a definitive RPC RAISE (unknown stage/contact, cross-tenant, unauthorized) is a TERMINAL `failed`.
//   * a transport/throw (we cannot know whether the txn committed) is `ambiguous` — reconciled by the act's
//     own correlation ref against the transition log, NEVER blind-resent. The monotonic ledger RPC allows a
//     later ambiguous→executed reconcile; a blind retry that double-advanced a journey is what this avoids.
//   * the subject is the EVENT's subject (a `clients` row); the contact id is never taken from the args.
//     The target stage slug comes from the governed args and is used only to DRIVE the write; a
//     missing/blank slug fails closed on dispatch. The readback needs NO slug — it reconciles by correlation
//     alone, so a crash-recovery drain (which no longer holds the governed args) still confirms honestly (§39 F4).

import type { ActionAdapter, AdapterCapability, DispatchInput, DispatchResult } from "./adapters.ts";
import { weeklyCommitmentExecutor } from "./weekly-commitment-adapter.ts";

// ── The native action registry: exact action_kind → executor. §18 one home; extend, never fork. ─────────
type NativeExecutor = {
  capability: AdapterCapability;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
  /** Standalone confirm — a pure CORRELATION reconcile (no slug needed). Same logic dispatch runs inline. */
  readback(providerRef: string | null, input: DispatchInput): Promise<DispatchResult>;
};

/** Read the target stage slug from the governed args. Accepts `stage_slug` / `to_stage_slug` / `slug`.
 *  Returns null (→ fail closed) for anything that is not a non-empty string — never guesses a stage.
 *  Used ONLY to DRIVE the write on dispatch; confirmation never depends on it. */
function readStageSlug(args: unknown): string | null {
  if (args == null || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  const v = a.stage_slug ?? a.to_stage_slug ?? a.slug;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Reconcile a journey advance by THIS act's OWN correlation ref against the canonical transition log (§32).
 * This is the ONLY confirmation signal — it proves OUR write landed regardless of the contact's current
 * slug, so a concurrent act moving the contact (to the same stage or onward) can never false-confirm (§39 F3),
 * and a crash-recovery drain that no longer holds the governed target slug still reconciles honestly (§39 F4).
 *   * a transition row (contact_id = subject, source_event = correlationRef) exists  → executed (OUR write landed).
 *   * no such row, clean read                                                        → ambiguous (not yet / never landed).
 *   * the read errors                                                                → ambiguous (canonical_read_error).
 * NEVER returns executed on a current-slug match alone, and NEVER blind-retries — an unconfirmed advance is
 * `ambiguous` (the monotonic RPC permits a later ambiguous→executed once a reconcile confirms it).
 */
async function reconcileByCorrelation(input: DispatchInput): Promise<DispatchResult> {
  const { db, tenantId, subjectId, correlationRef } = input;
  try {
    const { data, error } = await db
      .from("paige_journey_stage_transitions")
      .select("id, to_stage_slug")
      .eq("contact_id", subjectId)
      .eq("source_event", correlationRef)
      .limit(1);
    if (error) {
      return {
        outcome: "ambiguous", providerRef: null,
        detail: { reason: "canonical_read_error" },
        error: (error as { message?: string }).message ?? String(error),
      };
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length > 0) {
      const landed = rows[0] as Record<string, unknown>;
      return {
        outcome: "executed", providerRef: null,
        detail: {
          confirmed_via: "transition_correlation",
          ...(typeof landed.to_stage_slug === "string" ? { stage_slug: landed.to_stage_slug } : {}),
        },
      };
    }
  } catch (e) {
    return { outcome: "ambiguous", providerRef: null, detail: { reason: "canonical_read_error" }, error: e instanceof Error ? e.message : String(e) };
  }
  // No transition stamped with OUR correlation ref → we cannot confirm OUR write landed. Ambiguous, never
  // blind-retried; the tenant-scoped tenantId is carried through for the caller's reconcile decision.
  return { outcome: "ambiguous", providerRef: null, detail: { reason: "not_confirmed_by_correlation", tenant_id: tenantId }, error: null };
}

/** The journey-stage executor. dispatch calls set_journey_stage, then reconciles by correlation. */
const journeyStageExecutor: NativeExecutor = {
  capability: {
    id: "crm_advance_journey_stage",
    effect: "mutate",
    outcomeChannel: "paige_act_executions",
    // NO availability is asserted here (owner correction, 2026-09-13): the adapter never declares a
    // Layer-C availability. The engine resolves this capability's REAL availability + tier/connection
    // posture THROUGH the canonical Gateway seam (resolveNativeCapabilityStatus) before any dispatch, and
    // feeds it to decideGovernedExecution's availability gate. A Layer-C `live` literal was exactly the
    // fallback rule the correction forbids.
  },
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { db, subjectTable, subjectId, args, correlationRef } = input;

    // The subject of the event must be a contact; the contact id is the subject, never an arg (§9).
    if (subjectTable !== "clients") {
      return { outcome: "failed", providerRef: null, error: "native_journey_subject_not_clients", detail: { subject_table: subjectTable } };
    }
    const targetSlug = readStageSlug(args);
    if (!targetSlug) {
      return { outcome: "failed", providerRef: null, error: "native_journey_missing_stage_slug", detail: {} };
    }

    let res: { data: unknown; error: unknown };
    try {
      res = await db.rpc("set_journey_stage", {
        _contact_id: subjectId,
        _stage_slug: targetSlug,
        _source_event: correlationRef, // the act's correlation ref stamps the transition row → reconcilable
      });
    } catch (e) {
      // Transport/throw BEFORE we know if the txn committed → ambiguous (reconcile, never blind retry).
      return { outcome: "ambiguous", providerRef: null, detail: { stage_slug: targetSlug, reason: "dispatch_threw" }, error: e instanceof Error ? e.message : String(e) };
    }
    if (res.error) {
      // A definitive Postgres RAISE (unknown stage/contact, cross-tenant, unauthorized) — the txn aborted,
      // nothing wrote. Terminal `failed` (a retry cannot fix a bad slug or a deleted contact).
      const msg = (res.error as { message?: string }).message ?? String(res.error);
      return { outcome: "failed", providerRef: null, error: msg, detail: { action: "set_journey_stage", stage_slug: targetSlug } };
    }
    const out = (res.data ?? {}) as Record<string, unknown>;
    // No-op: already on the target slug (set_journey_stage returns BEFORE any write). The contact is in the
    // confirmed desired state → executed, and NO duplicate transition row was written (idempotent). Reported
    // HONESTLY (owner) as `already_at_requested_stage` — NEVER as a newly advanced journey (the caller
    // suppresses the "advanced" Rail on this flag; the receipt records the no-op truthfully).
    if (out.unchanged === true) {
      return { outcome: "executed", providerRef: null, detail: { already_at_requested_stage: true, stage_slug: targetSlug } };
    }
    // Changed: confirm OUR write persisted via the correlation reconcile (§32) — never a bare slug match.
    return reconcileByCorrelation(input);
  },
  async readback(_providerRef: string | null, input: DispatchInput): Promise<DispatchResult> {
    // Pure correlation reconcile — needs NO stage slug, so it works for a crash-recovery drain that no
    // longer holds the governed args (§39 F4) and never false-confirms from a concurrent slug move (§39 F3).
    return reconcileByCorrelation(input);
  },
};

// owner.task is an internal task, not a generic tool invocation. The event/act
// ledger supplies the native actor, exact reviewed args and occurrence identity.
// Even an automatic process cannot use this vertical without native redemption.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function ownerTaskCall(input: DispatchInput, readback: boolean): Promise<DispatchResult> {
  const unknown = (): DispatchResult => ({ outcome: "ambiguous", detail: { reason: "owner_task_native_outcome_unconfirmed", proven_absent: false } });
  if (input.subjectTable !== "clients" || !UUID.test(input.subjectId) || !UUID.test(input.tenantId)
    || !UUID.test(input.eventId ?? "") || !UUID.test(input.actId ?? "") || !UUID.test(input.correlationRef)) {
    return readback ? unknown() : { outcome: "failed", error: "owner_task_invalid_occurrence", detail: {} };
  }
  try {
    // No browser/model args or actor are forwarded. The native bridge captures,
    // locks and validates the protected held context and original native approver.
    const { data, error } = await input.db.rpc(readback ? "read_owner_task_act" : "execute_owner_task_act", {
      _event_id: input.eventId, _act_id: input.actId, _correlation: input.correlationRef,
    });
    if (error || data == null || typeof data !== "object") return unknown();
    if (!readback && data.outcome === "accepted_for_execution" && data.proven_no_effect === true) {
      return { outcome: "accepted_for_execution", detail: { reason: "owner_task_context_locked", proven_no_effect: true } };
    }
    if (!readback && data.outcome === "failed") return { outcome: "failed", error: "owner_task_native_rejected", detail: { reason: data.reason } };
    if (readback && data.state === "absent") return { outcome: "ambiguous", detail: { reason: "owner_task_not_recorded", proven_absent: true } };
    const result = data.result, task = result?.readback;
    if (data.state !== "found" || result?.ok !== true || result.action !== "task.create" || result.outcome !== "succeeded"
      || result.receipt_recorded !== true || !UUID.test(String(task?.id ?? "")) || !UUID.test(String(data.actor_id ?? ""))
      || task?.assignee_user_id !== data.actor_id || task.external_effect !== false || task.notification_sent !== false) return unknown();
    return { outcome: "executed", providerRef: null, detail: { confirmed_via: "crm_command_result", task_id: task.id,
      native_actor_id: data.actor_id, correlation_ref: input.correlationRef } };
  } catch { return unknown(); }
}
const ownerTaskExecutor: NativeExecutor = {
  capability: { id: "crm_create_task", effect: "mutate", outcomeChannel: "paige_act_executions" },
  dispatch: input => ownerTaskCall(input, false),
  readback: (_providerRef, input) => ownerTaskCall(input, true),
};

// Keyed by the act's `action_kind` — the DOTTED action-bus slug (FK to paige_action_kinds), matching the
// capability-status manifest key. The executor's capability.id below stays the UNDERSCORE tool/risk key
// (crm_advance_journey_stage) that action-risk + the receipt use — the standard dotted-kind ↔ underscore-tool seam.
const NATIVE_EXECUTORS: Readonly<Record<string, NativeExecutor>> = {
  "crm.advance_journey_stage": journeyStageExecutor,
  "planning.weekly_commitment_check": weeklyCommitmentExecutor,
  "owner.task": ownerTaskExecutor,
};

/** True when an action_kind has a registered native executor (adapters.ts routes these to "native"). */
export function isNativeActionKind(actionKind: string | null | undefined): boolean {
  return !!actionKind && Object.prototype.hasOwnProperty.call(NATIVE_EXECUTORS, actionKind);
}

/** The native ActionAdapter: resolveCapability + dispatch/readback delegate to the per-action executor. */
export const nativeAdapter: ActionAdapter = {
  kind: "native",
  // The readback finds the transition stamped with the act's own correlation reference or proves there is none,
  // so an act whose dispatcher died without landing it may be dispatched again under a fresh claim.
  lostClaimRecovery: "readback_proves_absence",
  resolveCapability(actionKind: string): AdapterCapability | null {
    const ex = NATIVE_EXECUTORS[actionKind];
    return ex ? ex.capability : null;
  },
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const ex = NATIVE_EXECUTORS[input.actionKind];
    if (!ex) return { outcome: "failed", providerRef: null, error: "native_action_unsupported", detail: { action_kind: input.actionKind } };
    return ex.dispatch(input);
  },
  async readback(providerRef: string | null, input: DispatchInput): Promise<DispatchResult> {
    const ex = NATIVE_EXECUTORS[input.actionKind];
    if (!ex) return { outcome: "failed", providerRef: null, error: "native_action_unsupported", detail: { action_kind: input.actionKind } };
    return ex.readback(providerRef, input);
  },
};

/** Exposed for unit tests: the correlation reconcile helper and slug reader. */
export const __test = { reconcileByCorrelation, readStageSlug, NATIVE_EXECUTORS };
