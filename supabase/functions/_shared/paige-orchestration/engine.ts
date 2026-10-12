// Paige Runtime Harness — Layer C: the connector-neutral governed event→act ENGINE.
//
// Called by the native-event drainer (paige-native-event-dispatch) after it claims an event. For each
// LIVE subscriber (a §67 paige_automations process record whose trigger_key matches the event), it runs
// the one governed pathway for each ordered act:
//
//   conditions match?  → resolve effective autonomy lane (grant ∧ ceiling ∧ §68 decay)
//   → per act: resolve the connector-neutral adapter + governed capability
//   → decideGovernedExecution (the ONE pathway; auto acts are attributed to the authorizing PERSON, since
//     a service principal may not be the approver of a mutation — governedExecution.ts:188-193)
//   → record the EXACT per-act outcome + a durable correlation/idempotency record (paige_act_executions)
//   → (C2, phase 5) for a native, synchronous execute: DISPATCH the in-tenant write, re-read the canonical
//     record to CONFIRM (§32), advance the ledger to executed|failed|ambiguous via the monotonic RPC, and
//     file the receipt + owner Rail on a confirmed executed.
//
// The durable `accepted_for_execution` record is written BEFORE any dispatch, so a crash between the two
// leaves a reconcilable pre-dispatch record, never a phantom effect. Only a native adapter executes here;
// an EXTERNAL-EFFECT adapter (n8n) still stops at accepted_for_execution / approval_pending — its dispatch
// + signed readback is C3+. Every non-execute branch records its exact outcome (condition_not_matched /
// held_by_lane / approval_pending / refused_* / failed-unsupported_adapter) — never a blanket "automation ran".
//
// The GOVERNANCE decisions live in pure, unit-provable functions (buildGovernedInputs, outcomeFromDecision);
// this file's I/O is loading acts, resolving the lane + authorizing person, writing the ledger, and (C2)
// driving the native adapter's dispatch/confirm + best-effort receipt/Rail. Nothing here is
// n8n-/Telegram-specific — adapters are resolved by kind (adapters.ts).

import {
  decideGovernedExecution,
  type GovernedDecision,
} from "../paige-spine/governedExecution.ts";
import {
  adapterForAction,
  resolveAdapterKind,
  type AdapterCapability,
  type ActionAdapter,
  type DispatchResult,
} from "./adapters.ts";
import {
  evaluateConditions,
  laneNonExecuteOutcome,
  refusalToOutcome,
  type ActOutcome,
  type EventFacts,
} from "./decide.ts";
import { actReceiptRunSeed, FINAL_OUTCOME_SET } from "./outcomes.ts";
import { recordCapabilityRun, stableRunId } from "../capability-record.ts";
import { emitAutomationRail } from "../railAutomation.ts";
import { resolveNativeCapabilityStatus } from "../paige-capability-status/gatherer.ts";
import type { CapabilityAvailability } from "../paige-capability-status/resolver.ts";

// ── Inputs the drainer hands the engine ──────────────────────────────────────────────────────────────
export type ClaimedEvent = {
  event_id: string;
  tenant_id: string;         // authoritative — from the claimed row, never a request body (§9)
  event_key: string;
  subject_table: string;
  subject_id: string;
  payload: Record<string, unknown>;
};
export type AutomationRow = {
  id: string;
  name: string;
  granted_lane: string;
  conditions: unknown;       // jsonb array
  created_by: string | null; // the authorizing person for an `auto` grant
  state: string;
};
export type ActRow = {
  id: string;
  position: number;
  action_kind: string | null;
  tool_key: string | null;
  config: Record<string, unknown> | null;
};

// A minimal supabase-js-like client surface (keeps the engine testable without importing the SDK type).
// `args` is OPTIONAL so EngineDb stays assignable to the shared seams the engine hands it to whose own
// rpc arg is optional (emitAutomationRail's RpcClient) — the real Deno strict-null typecheck (which the
// src tsc, strictNullChecks-off, does not enforce) rejects a required-arg rpc there (§32). Every engine
// call still passes args; optional only widens assignability, never the runtime contract.
export type EngineDb = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

// ── PURE: build the one-governed-pathway inputs for a single act (auto lane, person-attributed) ────────
export type GovernedInputs = Parameters<typeof decideGovernedExecution>[0];

export function buildGovernedInputs(params: {
  tenantId: string;
  personUserId: string;        // the resolved authorizing person (active tenant member)
  effectiveLane: string;       // the resolved effective lane ("auto" on this path)
  capability: AdapterCapability;
  actConfig: unknown;
  /** The availability RESOLVED THROUGH THE CANONICAL GATEWAY (never a Layer-C literal — owner correction,
   *  2026-09-13). A native execute act threads the Gateway's per-tenant status here; a non-native adapter
   *  (n8n) passes nothing → `"unknown"`, a no-op at the availability gate (its real per-tenant resolution
   *  is owed in C3+). The gate refuses a `not_for_tier`/`needs_setup`/`unavailable`/`planned` value. */
  availability?: CapabilityAvailability | "unknown";
}): GovernedInputs {
  const { tenantId, personUserId, effectiveLane, capability, actConfig, availability } = params;
  return {
    caller: {
      authenticated: true,
      userId: personUserId,
      principal: "person",        // the standing `auto` grant IS this person's pre-authorization
      tenantId,
      tenantSource: "server",     // resolved from the claimed event row, never a request body
      door: "automation",
      access: { allowed: true },  // the authorizing person's active-membership was verified before this
    },
    capability: {
      id: capability.id,
      effect: capability.effect,
      ...(capability.effect === "mutate" ? { outcomeChannel: capability.outcomeChannel ?? "paige_act_executions" } : {}),
      availability: availability ?? "unknown",
    },
    approval: { autonomyLane: effectiveLane }, // no claimedArgs — the grant, not a single-use human claim
    requestArgs: actConfig ?? {},
  };
}

// ── PURE: map a governed decision to the exact slice-1 per-act outcome ─────────────────────────────────
export type ActDecisionOutcome = {
  outcome: ActOutcome;
  refusalCode?: string;
  error?: string;
  args?: unknown;
};

export function outcomeFromDecision(decision: GovernedDecision): ActDecisionOutcome {
  if (decision.kind === "execute") {
    // Slice 1: authorized + about to be durably recorded. The external dispatch is slice 2.
    return { outcome: "accepted_for_execution", args: decision.args };
  }
  if (decision.kind === "propose") {
    // The governed seam wants a human yes — the act is held pending approval (never executed here).
    return { outcome: "approval_pending" };
  }
  // refuse — map to the exact refused_* outcome; never a success.
  return { outcome: refusalToOutcome(decision.code), refusalCode: decision.code, error: decision.message };
}

// ── The ledger row the engine writes (paige_act_executions). ───────────────────────────────────────────
export type ActExecutionRecord = {
  event_id: string;
  automation_id: string;
  act_id: string;
  act_position: number;
  tenant_id: string;
  adapter_kind: string;
  capability_key: string | null;
  effective_lane: string | null;
  outcome: ActOutcome;
  refusal_code: string | null;
  idempotency_key: string;
  correlation_ref: string;
  provider_ref: string | null;   // the provider's own execution/correlation id, once known (slice 2)
  detail: Record<string, unknown>;
  error: string | null;
};

/** Verify the process's authorizing person is still an active member of the tenant. An `auto` mutation is
 *  attributed to this person. The result DISTINGUISHES an infra error (retry — the caller must not decide)
 *  from a genuine non-member (`userId: null` — a real refused_authority). A swallowed read error must never
 *  masquerade as a settled "authority refused" (§13/§32). */
type PersonResult = { ok: true; userId: string | null } | { ok: false; error: string };
async function resolveAuthorizingPerson(
  db: EngineDb, createdBy: string | null, tenantId: string,
): Promise<PersonResult> {
  if (!createdBy) return { ok: true, userId: null };   // genuinely no configured author — a real refusal
  const { data, error } = await db
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", createdBy)
    .eq("status", "active")
    .limit(1);
  if (error) return { ok: false, error: error.message ?? String(error) };  // INFRA error — retry, not a refusal
  if (!Array.isArray(data) || data.length === 0) return { ok: true, userId: null }; // genuinely not an active member
  return { ok: true, userId: createdBy };
}

/** Load an automation's acts. DISTINGUISHES an infra error (retry) from a genuinely empty act list — a
 *  swallowed read error must never look like "no acts" and let the event complete silently (§13/§32). */
type LoadActsResult = { ok: true; acts: ActRow[] } | { ok: false; error: string };
async function loadActs(db: EngineDb, automationId: string): Promise<LoadActsResult> {
  const { data, error } = await db
    .from("paige_automation_acts")
    .select("id, position, action_kind, tool_key, config")
    .eq("automation_id", automationId)
    .order("position", { ascending: true });
  if (error) return { ok: false, error: error.message ?? String(error) };
  if (!Array.isArray(data)) return { ok: false, error: "paige_automation_acts returned a non-array" };
  return { ok: true, acts: data as ActRow[] };
}

/** Outcomes that are FINAL for the drainer. DERIVED from the one canonical home (outcomes.ts `FINAL_OUTCOMES`,
 *  C4/§18), which is pinned set-for-set to `_final` in the monotonic RPC (20270126000000) by the drift guard —
 *  so the engine's "never re-dispatch a final row" set can no longer drift from the RPC's. Once a row holds one
 *  of these, phase 5 adopts it and NEVER re-dispatches (idempotency across re-drains). */
const FINAL_OR_SETTLED: ReadonlySet<string> = FINAL_OUTCOME_SET;

/** A process's CURRENT posture, as `resolve_automation_autonomy` returns it (grant ∧ most-restrictive act floor
 *  ∧ Trust-Compass ceiling ∧ §68 decay). */
export type ProcessPosture = { found?: boolean; state?: string; effective?: string; capped_by?: string | null };

/** The ONE posture read. The engine reads it when it decides an act; the approval executor re-reads it when a
 *  held act is approved (INT-179), so the two can never read a process's posture differently. */
export async function readProcessPosture(
  db: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  automationId: string,
): Promise<{ data: ProcessPosture | null; error: unknown }> {
  const { data, error } = await db.rpc("resolve_automation_autonomy", { _automation_id: automationId });
  return { data: (data ?? null) as ProcessPosture | null, error };
}

/** Read the CURRENT ledger outcome for one (event, act). `outcome:null` = the row does not exist yet.
 *  An infra read error returns `{ ok:false }` so phase 5 retries rather than acting blind (§13/§32). */
type CurrentOutcome = { ok: true; outcome: string | null } | { ok: false; error: string };
async function readActOutcome(db: EngineDb, eventId: string, actId: string): Promise<CurrentOutcome> {
  const { data, error } = await db
    .from("paige_act_executions")
    .select("outcome")
    .eq("event_id", eventId)
    .eq("act_id", actId)
    .limit(1);
  if (error) return { ok: false, error: error.message ?? String(error) };
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, outcome: rows.length > 0 ? ((rows[0] as { outcome?: unknown }).outcome as string ?? null) : null };
}

/** A governed-authorized native, synchronous act to dispatch AFTER its accepted_for_execution record
 *  persists (C2). Only produced for an `execute` decision whose adapter is a native executor. */
export type NativeExecutePlan = {
  adapter: ActionAdapter;
  capabilityKey: string;   // the governed capability id (the action-risk key) — for the receipt
  args: unknown;           // the args decideGovernedExecution returned on the execute branch
  personUserId: string;    // the authorizing person (active member) — receipt actor
  automationName: string;  // the process name — the owner Rail label (humanized by the emitter)
};
export type ActBuild = { record: ActExecutionRecord; execute?: NativeExecutePlan };

/** Build one ledger record for an act, running the governed pathway where the lane permits. Returns the
 *  record plus (only for a native execute) the dispatch plan the caller runs after the record persists.
 *  Pure except for the async stableRunId (idempotency key derivation). */
async function decideActRecord(params: {
  event: ClaimedEvent;
  automation: AutomationRow;
  act: ActRow;
  laneOutcome: ActOutcome | null;   // non-null → a non-execute outcome already decided by the lane
  effectiveLane: string;
  personUserId: string | null;
  /** For a NATIVE act, the availability resolved through the canonical Gateway (owner correction). A
   *  refusing value makes decideGovernedExecution refuse at the availability gate — never a dispatch. */
  gatewayAvailability?: CapabilityAvailability;
}): Promise<ActBuild> {
  const { event, automation, act, laneOutcome, effectiveLane, personUserId, gatewayAvailability } = params;
  const adapterKind = resolveAdapterKind(act.action_kind);
  const idempotency_key = await stableRunId(["paige-act", event.event_id, act.id]);
  const base = {
    event_id: event.event_id,
    automation_id: automation.id,
    act_id: act.id,
    act_position: act.position,
    tenant_id: event.tenant_id,
    adapter_kind: adapterKind,
    capability_key: act.action_kind ?? act.tool_key ?? null,
    effective_lane: effectiveLane,
    refusal_code: null as string | null,
    idempotency_key,
    correlation_ref: idempotency_key,
    provider_ref: null as string | null,
    detail: {} as Record<string, unknown>,
    error: null as string | null,
  };

  // Lane already decided a non-execute outcome (off → held, confirm → approval_pending).
  if (laneOutcome) {
    const detail: Record<string, unknown> = { effective_lane: effectiveLane };
    // C5/§P1 (Codex peer-gate): a HELD (approval_pending) act SNAPSHOTS its governed args into the IMMUTABLE
    // ledger row, so the approval-executor dispatches EXACTLY what the reviewer approved — never the live
    // paige_automation_acts.config, which a tenant admin can mutate between the hold and the approval (a
    // confused-deputy / TOCTOU: approval could execute a stage slug different from the one the reviewer saw, §70.2).
    if (laneOutcome === "approval_pending") detail.snapshot_args = act.config ?? {};
    return { record: { ...base, outcome: laneOutcome, detail } };
  }

  // auto lane — resolve the adapter + governed capability, then the one pathway.
  const adapter = adapterForAction(act.action_kind);
  const capability = adapter?.resolveCapability(act.action_kind ?? "");
  if (!adapter || !capability) {
    return { record: { ...base, outcome: "failed", error: "unsupported_adapter", detail: { action_kind: act.action_kind } } };
  }
  if (!personUserId) {
    return {
      record: {
        ...base, outcome: "refused_authority", refusal_code: "no_authorizing_person",
        error: "the process has no active authorizing person for its auto grant",
      },
    };
  }
  // Availability threads THROUGH the Gateway for a native act (resolved by the caller); a non-native
  // adapter passes nothing → "unknown" (a gate no-op — unchanged C1 behavior for n8n).
  const availability: CapabilityAvailability | "unknown" =
    adapterKind === "native" ? (gatewayAvailability ?? "unavailable") : "unknown";
  const decision = decideGovernedExecution(buildGovernedInputs({
    tenantId: event.tenant_id, personUserId, effectiveLane, capability, actConfig: act.config ?? {}, availability,
  }));
  const dec = outcomeFromDecision(decision);
  const record: ActExecutionRecord = {
    ...base,
    outcome: dec.outcome,
    refusal_code: dec.refusalCode ?? null,
    error: dec.error ?? null,
    detail: { capability: capability.id, decision: decision.kind, risk: decision.audit.risk },
  };
  // C5/§P1 (Codex peer-gate): a HIGH act clamped auto→propose also lands approval_pending — snapshot its
  // governed args into the immutable ledger row (same reason as the confirm-lane branch above).
  if (dec.outcome === "approval_pending") record.detail.snapshot_args = act.config ?? {};

  // C2: a governed-AUTHORIZED native, synchronous execute becomes a dispatch plan. It runs ONLY after the
  // durable accepted_for_execution record persists (phase 5), so a crash before dispatch leaves a
  // reconcilable pre-dispatch record, never a phantom effect. Non-native adapters (n8n) stay at
  // accepted_for_execution here — their external dispatch is C3+.
  if (dec.outcome === "accepted_for_execution" && adapterKind === "native" && typeof adapter.dispatch === "function") {
    return {
      record,
      execute: { adapter, capabilityKey: capability.id, args: dec.args, personUserId, automationName: automation.name },
    };
  }
  return { record };
}

export type EngineResult = {
  records: ActExecutionRecord[];
  by_outcome: Record<string, number>;
  /** act_ids whose durable ledger write FAILED. A non-empty list fails the dispatch for retry (owner
   *  correction #3): the drainer must NOT complete an event whose per-act outcome was not durably recorded. */
  persist_failures: string[];
  /** automation_ids skipped because an INFRA read/resolve FAILED (act load, autonomy resolve, or the
   *  authorizing-person read). The engine recorded NOTHING for them — no false condition_not_matched /
   *  held_by_lane / refused_authority — and the drainer fails their delivery for retry (§13/§32, F2). */
  subscriber_retry: string[];
  /** automation_ids with a NATIVE act left in a NON-terminal, still-reconcilable state
   *  (accepted_for_execution / retrying / ambiguous) after this drain. The drainer must NOT complete such
   *  an event `done`: it fails the delivery so the sweeper re-drives, and phase 5 reconciles the row BY
   *  CORRELATION on the next drain (an `ambiguous` row is re-read, never blind re-dispatched; an
   *  `accepted`-never-landed row is idempotently re-dispatched). The EXISTING event lifecycle + sweeper is
   *  the reconcile trigger — no second cron (§18) — and its attempts cap means a genuinely stuck row lands
   *  in `error` (visible), never a silent `done`. This is what makes the ambiguous-before-retry reconcile
   *  REACHABLE in production rather than only in a re-drain that happened to be caused by a crash (§39 F1). */
  reconcile_pending: string[];
};

/** Orchestrate all acts for a claimed event across its live subscribers, writing the exact per-act
 *  outcome to paige_act_executions (fire-once). Returns a summary for the drainer's response. */
export async function runEventActs(
  db: EngineDb, event: ClaimedEvent, subscribers: AutomationRow[],
): Promise<EngineResult> {
  const facts: EventFacts = {
    event_key: event.event_key,
    subject_table: event.subject_table,
    subject_id: event.subject_id,
    payload: event.payload ?? {},
  };
  const records: ActExecutionRecord[] = [];
  const subscriber_retry: string[] = [];
  // C2: native, synchronous execute plans, keyed by act_id, dispatched in phase 5 after their durable
  // accepted_for_execution records persist.
  const executePlans = new Map<string, NativeExecutePlan>();
  const collect = (built: ActBuild): void => {
    records.push(built.record);
    if (built.execute) executePlans.set(built.record.act_id, built.execute);
  };

  for (const automation of subscribers) {
    // Load acts. An INFRA error is a RETRYABLE subscriber — never a false "no acts" that completes silently.
    const actsRes = await loadActs(db, automation.id);
    if (!actsRes.ok) { subscriber_retry.push(automation.id); continue; }
    const acts = actsRes.acts;
    if (acts.length === 0) continue;   // genuinely no acts to govern — nothing to record

    // 1 — conditions (closes TODO F3): a non-match records condition_not_matched for every act.
    const verdict = evaluateConditions(automation.conditions, facts);
    if (!verdict.matched) {
      for (const act of acts) {
        collect(await decideActRecord({
          event, automation, act, effectiveLane: automation.granted_lane,
          laneOutcome: "condition_not_matched", personUserId: null,
        }));
      }
      continue;
    }

    // 2 — effective autonomy lane = grant ∧ most-restrictive act floor ∧ Trust-Compass ceiling ∧ §68 decay.
    //     An INFRA/malformed resolve is a RETRYABLE subscriber — NEVER coerced to a false `off`/held_by_lane
    //     (a FINAL state that would bake a transient error as a permanent governance verdict, §13/§32 F2).
    const { data: laneRow, error: laneErr } = await readProcessPosture(db, automation.id);
    if (laneErr || !laneRow || typeof laneRow.effective !== "string") { subscriber_retry.push(automation.id); continue; }
    const effectiveLane: string = laneRow.effective;
    const laneOutcome = laneNonExecuteOutcome(effectiveLane); // null → auto proceeds
    if (laneOutcome) {
      for (const act of acts) {
        collect(await decideActRecord({
          event, automation, act, effectiveLane, laneOutcome, personUserId: null,
        }));
      }
      continue;
    }

    // 3 — auto lane: resolve the authorizing person once. An INFRA error is a RETRYABLE subscriber; a genuine
    //     non-member (userId null) is a real refused_authority (decideActRecord records it).
    const personRes = await resolveAuthorizingPerson(db, automation.created_by, event.tenant_id);
    if (!personRes.ok) { subscriber_retry.push(automation.id); continue; }
    const personUserId = personRes.userId;

    // 3.5 — for each NATIVE act, resolve its availability THROUGH the canonical Gateway seam BEFORE the
    //       governed decision (owner correction, 2026-09-13 — never a Layer-C availability literal). Only
    //       meaningful when there IS an authorizing person (otherwise the act is refused_authority anyway).
    //       An INFRA failure of the Gateway resolution is a RETRYABLE subscriber — never a false refusal.
    const availByAct = new Map<string, CapabilityAvailability>();
    if (personUserId) {
      let gatewayInfraError = false;
      for (const act of acts) {
        if (resolveAdapterKind(act.action_kind) !== "native") continue;
        const g = await resolveNativeCapabilityStatus(db, {
          actorUserId: personUserId, tenantId: event.tenant_id, actionKind: act.action_kind ?? "",
        });
        if (!g.ok) { gatewayInfraError = true; break; }
        availByAct.set(act.id, g.status.availability);
      }
      if (gatewayInfraError) { subscriber_retry.push(automation.id); continue; }
    }
    for (const act of acts) {
      collect(await decideActRecord({
        event, automation, act, effectiveLane, laneOutcome: null, personUserId,
        gatewayAvailability: availByAct.get(act.id),
      }));
    }
  }

  // 4 — persist each record through the ATOMIC, MONOTONIC transition RPC (never a bare upsert). Every
  //     write is CHECKED (owner correction #3): a failed durable write puts the act_id in
  //     `persist_failures`, and the drainer fails the dispatch for retry rather than claiming completion.
  //     The RPC RETURNS the row that ACTUALLY persisted, so we report the persisted outcome (§13) — a
  //     re-drain that lands on an already-final row reports THAT final outcome, never our recomputed guess.
  const persist_failures: string[] = [];
  for (const rec of records) {
    // EVERY native-adapter record is handled ENTIRELY by phase 5 (read-current-first), whatever its
    // decided outcome. Persisting a native record here would let a re-drain overwrite an advanceable
    // `accepted`/`ambiguous` row (a prior drain's in-flight/unconfirmed dispatch) with a freshly-flipped
    // FINAL non-execute decision (e.g. refused_authority) — permanently mis-recording a possibly-executed
    // advance (§39 F2). Phase 5 reconciles an advanceable native row instead of overwriting it.
    if (rec.adapter_kind === "native") continue;
    const { data, error } = await db.rpc("paige_record_act_execution", {
      _event_id: rec.event_id, _automation_id: rec.automation_id, _act_id: rec.act_id,
      _act_position: rec.act_position, _tenant_id: rec.tenant_id,
      _adapter_kind: rec.adapter_kind, _capability_key: rec.capability_key,
      _effective_lane: rec.effective_lane, _outcome: rec.outcome, _refusal_code: rec.refusal_code,
      _idempotency_key: rec.idempotency_key, _correlation_ref: rec.correlation_ref,
      _provider_ref: rec.provider_ref, _detail: rec.detail, _error: rec.error,
      _dispatched_at: null, _settled_at: null,
    });
    if (error || data == null) {
      persist_failures.push(rec.act_id);
      continue;
    }
    const persisted = (data as { outcome?: unknown }).outcome;
    if (typeof persisted === "string") rec.outcome = persisted as ActOutcome;
  }

  // 5 — NATIVE records (C2), READ-CURRENT-FIRST. Phase 4 skipped EVERY native record; phase 5 owns them so a
  //     re-drain can never (a) blind re-dispatch, nor (b) overwrite an advanceable row (a prior drain's
  //     in-flight/unconfirmed dispatch) with a freshly-flipped FINAL non-execute decision (§39 F2). Per record:
  //       * FINAL/settled current  → adopt (idempotent).
  //       * ADVANCEABLE current (accepted/retrying/ambiguous) → RECONCILE by the act's OWN correlation
  //         (readback: a transition stamped with this correlationRef proves OUR write landed, independent of
  //         the current slug — a concurrent move never false-confirms, §39 F3). Confirmed → executed (+Rail,
  //         a real advance, §39 F4). Unconfirmed: an `ambiguous` row STAYS ambiguous (owner: never blind
  //         re-dispatch); an `accepted` row that never landed IS dispatched when this drain still decides
  //         execute; a flipped no-plan decision leaves the advanceable row untouched (never refuses a
  //         possibly-executed advance, §39 F2).
  //       * ABSENT current → a plan (execute) writes the durable accepted record then dispatches; a no-plan
  //         (non-execute) decision records that exact decision now (moved out of phase 4).
  //     A confirmed executed files the receipt (honest detail) + owner Rail (suppressed on an idempotent
  //     no-op). Receipt/Rail need the plan's identity; a plan-less reconcile advances the durable ledger
  //     truth and defers the best-effort receipt/Rail (§13 — the ledger is the source of truth).
  const nowIso = new Date().toISOString();

  const persistNative = async (rec: ActExecutionRecord, outcome: ActOutcome, extra: {
    providerRef?: string | null; detail?: Record<string, unknown>; error?: string | null;
    dispatchedAt?: string | null; settledAt?: string | null;
  }): Promise<{ ok: true; id: string | null } | { ok: false }> => {
    const { data, error } = await db.rpc("paige_record_act_execution", {
      _event_id: rec.event_id, _automation_id: rec.automation_id, _act_id: rec.act_id,
      _act_position: rec.act_position, _tenant_id: rec.tenant_id,
      _adapter_kind: rec.adapter_kind, _capability_key: rec.capability_key,
      _effective_lane: rec.effective_lane, _outcome: outcome, _refusal_code: rec.refusal_code,
      _idempotency_key: rec.idempotency_key, _correlation_ref: rec.correlation_ref,
      _provider_ref: extra.providerRef ?? null, _detail: extra.detail ?? rec.detail, _error: extra.error ?? null,
      _dispatched_at: extra.dispatchedAt ?? null, _settled_at: extra.settledAt ?? null,
    });
    if (error || data == null) return { ok: false };
    const persisted = (data as { outcome?: unknown }).outcome;
    if (typeof persisted === "string") rec.outcome = persisted as ActOutcome;
    return { ok: true, id: (data as { id?: string }).id ?? null };
  };

  // Advance the ledger to a dispatch/reconcile result and (only for a real executed WITH a plan) file the
  // receipt + owner Rail (Rail suppressed on an idempotent no-op). Returns false on a durable-write failure.
  const advanceNative = async (rec: ActExecutionRecord, plan: NativeExecutePlan | undefined, result: DispatchResult): Promise<boolean> => {
    const settled = result.outcome === "executed" || result.outcome === "failed"; // ambiguous stays advanceable
    const w = await persistNative(rec, result.outcome as ActOutcome, {
      providerRef: result.providerRef ?? null,
      detail: { ...(rec.detail ?? {}), dispatch: result.detail ?? {} },
      error: result.error ?? null, dispatchedAt: nowIso, settledAt: settled ? nowIso : null,
    });
    if (!w.ok) { persist_failures.push(rec.act_id); return false; }
    if (rec.outcome === "executed" && plan) {
      const detail = (result.detail ?? {}) as Record<string, unknown>;
      const wasNoop = detail.already_at_requested_stage === true;
      const runId = await stableRunId(actReceiptRunSeed(rec.event_id, rec.act_id));
      await recordCapabilityRun(db, {
        tenantId: event.tenant_id, actorId: plan.personUserId, capabilityKey: plan.capabilityKey,
        outcome: "capability_succeeded", runId,
        detail: { correlation_ref: rec.correlation_ref, event_id: rec.event_id, act_id: rec.act_id, contact_id: event.subject_id, ...detail },
      });
      if (!wasNoop) {
        await emitAutomationRail(db, {
          tenantId: event.tenant_id, contactId: event.subject_id, workflowName: plan.automationName,
          phase: "completed", refTable: "paige_act_executions", refId: w.id,
        });
      }
    }
    return true;
  };

  const ambiguousResult = (e: unknown, reason: string): DispatchResult =>
    ({ outcome: "ambiguous", providerRef: null, error: e instanceof Error ? e.message : String(e), detail: { reason } });

  for (const rec of records) {
    if (rec.adapter_kind !== "native") continue;
    const plan = executePlans.get(rec.act_id);
    const adapter = plan?.adapter ?? adapterForAction(rec.capability_key);
    const nativeInput = {
      tenantId: event.tenant_id, actionKind: rec.capability_key ?? "", args: plan?.args ?? {},
      correlationRef: rec.correlation_ref, db, subjectTable: event.subject_table, subjectId: event.subject_id,
    };

    const cur = await readActOutcome(db, rec.event_id, rec.act_id);
    if (!cur.ok) { persist_failures.push(rec.act_id); continue; }                 // infra read error → retry
    if (cur.outcome && FINAL_OR_SETTLED.has(cur.outcome)) { rec.outcome = cur.outcome as ActOutcome; continue; }

    // ── current ADVANCEABLE (accepted/retrying/ambiguous): reconcile by correlation — never overwrite.
    if (cur.outcome != null) {
      const rb = adapter?.readback;
      if (typeof rb !== "function") { rec.outcome = cur.outcome as ActOutcome; continue; } // can't reconcile; leave advanceable
      let recon: DispatchResult;
      try { recon = await rb(null, nativeInput); } catch (e) { recon = ambiguousResult(e, "readback_threw"); }
      if (recon.outcome === "executed") { await advanceNative(rec, plan, recon); continue; }   // our write landed
      if (cur.outcome === "ambiguous") { rec.outcome = "ambiguous"; continue; }                // owner: never blind re-dispatch
      // an `accepted`/`retrying` row whose correlation shows NO landed transition → it never dispatched.
      if (plan && typeof plan.adapter.dispatch === "function") {
        let dr: DispatchResult;
        try { dr = await plan.adapter.dispatch(nativeInput); } catch (e) { dr = ambiguousResult(e, "adapter_threw"); }
        await advanceNative(rec, plan, dr); continue;
      }
      rec.outcome = cur.outcome as ActOutcome; continue; // no plan this drain → leave for a later drain/sweep
    }

    // ── current ABSENT.
    if (plan && typeof plan.adapter.dispatch === "function") {
      const acc = await persistNative(rec, "accepted_for_execution", { error: null }); // durable pre-dispatch record FIRST
      if (!acc.ok) { persist_failures.push(rec.act_id); continue; }
      let dr: DispatchResult;
      try { dr = await plan.adapter.dispatch(nativeInput); } catch (e) { dr = ambiguousResult(e, "adapter_threw"); }
      await advanceNative(rec, plan, dr); continue;
    }
    // a native record with a NON-execute decision (condition/held/approval/refused) — record it now.
    const w = await persistNative(rec, rec.outcome, { error: rec.error });
    if (!w.ok) persist_failures.push(rec.act_id);
  }

  const by_outcome: Record<string, number> = {};
  // A NATIVE record whose FINAL outcome is NOT terminal/settled is still reconcilable — the drainer must
  // keep the event reclaimable so phase 5 reconciles it on a later drain (§39 F1). Settled non-execute
  // outcomes (condition_not_matched / held_by_lane / approval_pending / refused_*) and terminals
  // (executed / failed / cancelled) are ALL in FINAL_OR_SETTLED, so only accepted_for_execution /
  // retrying / ambiguous qualify — exactly the states a correlation reconcile can still advance.
  const reconcileSet = new Set<string>();
  for (const rec of records) {
    by_outcome[rec.outcome] = (by_outcome[rec.outcome] ?? 0) + 1;
    if (rec.adapter_kind === "native" && !FINAL_OR_SETTLED.has(rec.outcome)) reconcileSet.add(rec.automation_id);
  }
  return { records, by_outcome, persist_failures, subscriber_retry, reconcile_pending: [...reconcileSet] };
}
