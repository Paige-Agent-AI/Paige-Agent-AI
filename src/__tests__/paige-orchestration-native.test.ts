/**
 * Layer C · C2 — the NATIVE synchronous auto-execute vertical, availability resolved THROUGH the Gateway.
 *
 * The act's `action_kind` is the DOTTED action-bus slug `crm.advance_journey_stage` (FK to
 * paige_action_kinds); the capability / tool / risk / receipt key is the UNDERSCORE
 * `crm_advance_journey_stage`. The two are the standard dotted-kind ↔ underscore-tool seam and the tests
 * hold that distinction explicitly.
 *
 * Part A: the native adapter (`native-adapter.ts`) — dispatch calls set_journey_stage and RETURNS the
 *   terminal outcome after a CORRELATION reconcile (§32): a change is confirmed ONLY by a transition row
 *   the RPC stamped with THIS act's correlation ref, NEVER by a bare current-slug match (a concurrent move
 *   to the same stage can never false-confirm, §39 F3); a no-op is reported honestly as
 *   `already_at_requested_stage` (never a newly advanced journey); a RAISE is terminal failed; a throw is
 *   ambiguous; an unconfirmed change is ambiguous. readback reconciles by correlation ALONE — it needs no
 *   stage slug, so a crash-recovery drain that no longer holds the governed args still confirms (§39 F4).
 *   The adapter declares NO availability — the Gateway owns it.
 * Part B: the engine (`engine.ts`) — a native act's availability is resolved THROUGH the canonical Gateway
 *   seam (resolveNativeCapabilityStatus) before the governed decision; a tier-ineligible actor is refused
 *   and NEVER dispatched. Phase 4 skips EVERY native record; phase 5 is READ-CURRENT-FIRST: a re-drain of a
 *   terminal row adopts it (no second dispatch); an `ambiguous` row is RECONCILED by readback (never blind
 *   re-dispatch, never overwritten by a re-flipped decision, §39 F2); an absent row writes the durable
 *   accepted_for_execution record before the domain write. Receipt fires on executed; the owner Rail is
 *   suppressed on an idempotent no-op.
 * Part C: the Gateway resolver (`gatherer.ts`) — resolves live / needs_approval / not_for_tier from the
 *   real (tier, owner-ops role, tool lane) with an explicit actor + tenant; an infra error returns {ok:false}.
 * Part D: registry sync (§39 F5) — the native executor registry and the Gateway capability bindings must
 *   carry IDENTICAL keys, or a vertical is dark (executor with no availability) / orphaned (binding with no run).
 */
import { describe, it, expect } from "vitest";
import {
  nativeAdapter,
  isNativeActionKind,
  __test as nativeTest,
} from "../../supabase/functions/_shared/paige-orchestration/native-adapter.ts";
import {
  resolveAdapterKind,
  adapterForAction,
  type AdapterDb,
  type DispatchInput,
} from "../../supabase/functions/_shared/paige-orchestration/adapters.ts";
import {
  buildGovernedInputs,
  runEventActs,
  type ClaimedEvent,
  type AutomationRow,
  type EngineDb,
} from "../../supabase/functions/_shared/paige-orchestration/engine.ts";
import {
  resolveNativeCapabilityStatus,
  hasNativeCapabilityBinding,
  nativeCapabilityBindingKeys,
} from "../../supabase/functions/_shared/paige-capability-status/gatherer.ts";

// The dotted action-bus slug (the act's action_kind) and the underscore tool/capability key it maps to.
const KIND = "crm.advance_journey_stage";
const TOOL = "crm_advance_journey_stage";

// ── A fake supabase-js surface for the native adapter + engine + Gateway (chainable, thenable). ─────────
type SetStageResult = { data?: unknown; error?: { message?: string } | null; throws?: boolean };
type DbConfig = {
  // native journey reconcile (adapter dispatch/readback) — correlation-only against the transition log
  transitionExists?: boolean;        // a transition stamped with our correlation ref exists
  transitionsError?: boolean;        // the transition read errors → ambiguous (canonical_read_error)
  setStage?: SetStageResult;
  // Gateway resolution (engine phase 3.5 / Part C)
  actorTier?: string;                 // get_actor_access.tier (default "tenant")
  actorRoles?: string[];              // user_roles — only `super_admin` grants authority now (C0a)
  // The canonical TENANT authority (C0a, "ADMIN IS A TENANT ROLE"): an owner/admin seat in THIS tenant
  // (is_tenant_admin_as) or the agency managing it (agency_can_manage_child). Default: the seat follows
  // the fixture's "admin" role, which is what production showed on 2026-10-04 (every global admin held a
  // seat), so existing cases keep their meaning; the new cases below set these explicitly to disagree.
  workspaceSeat?: boolean;
  agencyManages?: boolean;
  toolLane?: "auto" | "confirm" | "off"; // resolve_tool_autonomy (default "auto" → availability live)
  gatewayError?: "tier" | "role" | "lane"; // simulate an infra error in a Gateway ingredient
  // ledger current state (phase 5 readActOutcome)
  currentActOutcome?: string | null;  // paige_act_executions.outcome for the act (default null = absent)
  currentActReadError?: boolean;
  // engine C1 surfaces
  acts?: Record<string, Array<{ id: string; position: number; action_kind: string | null; tool_key: string | null; config: unknown }>>;
  activeMembers?: Set<string>;
  lanes?: Record<string, { effective: string }>; // resolve_automation_autonomy
  persistOutcomeOverride?: Record<string, string>;
  failAdvance?: boolean;              // fail a phase-5 ledger advance (a call carrying _dispatched_at)
  failAcceptedWrite?: boolean;        // fail the phase-5 accepted pre-dispatch write (_dispatched_at null)
  // capture
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  queryFilters: Array<{ table: string; filters: Record<string, unknown> }>;
};

function mockDb(cfg: DbConfig): AdapterDb & EngineDb {
  const makeQuery = (table: string) => {
    const filters: Record<string, unknown> = {};
    type MockQuery = {
      select(): MockQuery;
      order(): MockQuery;
      eq(k: string, v: unknown): MockQuery;
      limit(): MockQuery;
      maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      then(
        onF: (value: { data: unknown; error: unknown }) => unknown,
        onR?: (reason: unknown) => unknown,
      ): Promise<unknown>;
    };
    const q: MockQuery = {
      select() { return q; },
      order() { return q; },
      eq(k: string, v: unknown) { filters[k] = v; return q; },
      limit() { return q; },
      // single-row read over the same data (the shared authority module reads a membership this way)
      maybeSingle() {
        return q.then((r) => ({ ...(r as { data: unknown; error: unknown }),
          data: Array.isArray((r as { data: unknown }).data) ? ((r as { data: unknown[] }).data[0] ?? null) : (r as { data: unknown }).data,
        })) as Promise<{ data: unknown; error: unknown }>;
      },
      then(onF, onR) {
        cfg.queryFilters.push({ table, filters: { ...filters } });
        let data: unknown = [];
        let error: unknown = null;
        if (table === "paige_journey_stage_transitions") {
          if (cfg.transitionsError) error = { message: "transitions_read_failed" };
          else data = cfg.transitionExists ? [{ id: "tr1", to_stage_slug: "engaged" }] : [];
        } else if (table === "paige_act_executions") {
          if (cfg.currentActReadError) error = { message: "act_read_failed" };
          else data = cfg.currentActOutcome == null ? [] : [{ outcome: cfg.currentActOutcome }];
        } else if (table === "user_roles") {
          if (cfg.gatewayError === "role") error = { message: "user_roles_read_failed" };
          else data = (cfg.actorRoles ?? ["admin"]).map((role) => ({ role }));
        } else if (table === "paige_automation_acts") {
          data = cfg.acts?.[filters.automation_id as string] ?? [];
        } else if (table === "tenant_members") {
          data = cfg.activeMembers?.has(`${filters.tenant_id}:${filters.user_id}`) ? [{ user_id: filters.user_id }] : [];
        }
        return Promise.resolve({ data, error }).then(onF, onR);
      },
    };
    return q;
  };
  return {
    from: (t: string) => makeQuery(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      cfg.rpcCalls.push({ fn, args });
      if (fn === "set_journey_stage") {
        if (cfg.setStage?.throws) throw new Error("network_reset");
        return { data: cfg.setStage?.data ?? null, error: cfg.setStage?.error ?? null };
      }
      if (fn === "get_actor_access") {
        if (cfg.gatewayError === "tier") return { data: null, error: { message: "get_actor_access_failed" } };
        return { data: { tier: cfg.actorTier ?? "tenant" }, error: null };
      }
      if (fn === "is_tenant_admin_as") {
        if (cfg.gatewayError === "role") return { data: null, error: { message: "is_tenant_admin_as_failed" } };
        return { data: cfg.workspaceSeat ?? (cfg.actorRoles ?? ["admin"]).includes("admin"), error: null };
      }
      if (fn === "agency_can_manage_child") {
        return { data: cfg.agencyManages ?? false, error: null };
      }
      if (fn === "resolve_tool_autonomy") {
        if (cfg.gatewayError === "lane") return { data: null, error: { message: "resolve_tool_autonomy_failed" } };
        return { data: cfg.toolLane ?? "auto", error: null };
      }
      if (fn === "resolve_automation_autonomy") {
        return { data: cfg.lanes?.[args._automation_id as string] ?? { effective: "off" }, error: null };
      }
      if (fn === "paige_record_act_execution") {
        const actId = args._act_id as string;
        const isAdvance = args._dispatched_at != null;
        if (cfg.failAcceptedWrite && !isAdvance && args._outcome === "accepted_for_execution") return { data: null, error: { message: "accepted_write_failed" } };
        if (cfg.failAdvance && isAdvance) return { data: null, error: { message: "advance_write_failed" } };
        const outcome = cfg.persistOutcomeOverride?.[actId] ?? (args._outcome as string);
        return { data: { id: `row-${actId}`, outcome, ...args }, error: null };
      }
      if (fn === "record_capability_run" || fn === "record_rail_event" || fn === "resolve_contact_id") {
        return { data: fn === "resolve_contact_id" ? null : {}, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const baseInput = (cfg: DbConfig, over: Partial<DispatchInput> = {}): DispatchInput => ({
  tenantId: "t1",
  actionKind: KIND,
  args: { stage_slug: "engaged" },
  correlationRef: "corr-1",
  db: mockDb(cfg),
  subjectTable: "clients",
  subjectId: "c1",
  ...over,
});

// ═══ Part A — the native adapter ════════════════════════════════════════════════════════════════════

describe("native adapter — routing & capability (availability is NOT declared here — the Gateway owns it)", () => {
  it("routes the DOTTED action_kind to the native adapter (no native prefix, still native)", () => {
    expect(isNativeActionKind(KIND)).toBe(true);
    expect(isNativeActionKind(TOOL)).toBe(false); // the underscore is the tool key, NOT the action_kind
    expect(isNativeActionKind("n8n_run_workflow")).toBe(false);
    expect(isNativeActionKind(null)).toBe(false);
    expect(resolveAdapterKind(KIND)).toBe("native");
    expect(adapterForAction(KIND)).toBe(nativeAdapter);
  });

  it("resolveCapability maps the dotted kind to the UNDERSCORE-keyed mutating capability, NO availability literal", () => {
    const cap = nativeAdapter.resolveCapability(KIND);
    expect(cap).toEqual({ id: TOOL, effect: "mutate", outcomeChannel: "paige_act_executions" });
    expect((cap as Record<string, unknown>).availability).toBeUndefined();
    expect(nativeAdapter.resolveCapability("frobnicate")).toBeNull();
    expect(nativeAdapter.resolveCapability(TOOL)).toBeNull(); // the tool key is not an action_kind
  });

  it("buildGovernedInputs threads the EXPLICIT (Gateway-resolved) availability; absent → unknown", () => {
    const live = buildGovernedInputs({
      tenantId: "t1", personUserId: "u1", effectiveLane: "auto",
      capability: { id: TOOL, effect: "mutate", outcomeChannel: "paige_act_executions" },
      actConfig: {}, availability: "live",
    });
    expect((live.capability as { availability?: string }).availability).toBe("live");
    const dflt = buildGovernedInputs({
      tenantId: "t1", personUserId: "u1", effectiveLane: "auto",
      capability: { id: "n8n_run_workflow", effect: "mutate", outcomeChannel: "paige_act_executions" },
      actConfig: {},
    });
    expect((dflt.capability as { availability?: string }).availability).toBe("unknown");
  });
});

describe("native adapter — dispatch outcomes (§32 correlation confirm, §13 honest, no blind retry)", () => {
  it("changed + OUR correlation transition exists → executed (confirmed via transition_correlation, not the slug)", async () => {
    const cfg: DbConfig = { setStage: { data: { ok: true, to_stage_slug: "engaged", from_stage_slug: "new" } }, transitionExists: true, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("executed");
    expect((res.detail as { confirmed_via?: string })?.confirmed_via).toBe("transition_correlation");
    expect((res.detail as { stage_slug?: string })?.stage_slug).toBe("engaged");
    const setCall = cfg.rpcCalls.find((c) => c.fn === "set_journey_stage");
    expect(setCall?.args._source_event).toBe("corr-1");
    expect(setCall?.args._contact_id).toBe("c1");
    expect(setCall?.args._stage_slug).toBe("engaged");
    // the reconcile query keyed on OUR subject + correlation (never a bare slug), so a concurrent move can't false-confirm
    const tq = cfg.queryFilters.find((query) => query.table === "paige_journey_stage_transitions");
    expect(tq?.filters.contact_id).toBe("c1");
    expect(tq?.filters.source_event).toBe("corr-1");
    expect(tq?.filters.to_stage_slug).toBeUndefined(); // correlation-ONLY — the target slug is not a filter
  });

  it("no-op (already on target) → executed, reported as already_at_requested_stage (never a new advance), NO reconcile read", async () => {
    const cfg: DbConfig = { setStage: { data: { ok: true, unchanged: true, stage_slug: "engaged" } }, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("executed");
    expect((res.detail as { already_at_requested_stage?: boolean })?.already_at_requested_stage).toBe(true);
    expect((res.detail as { unchanged?: boolean })?.unchanged).toBeUndefined();
    expect(cfg.queryFilters.some((query) => query.table === "paige_journey_stage_transitions")).toBe(false);
  });

  it("a definitive RPC RAISE (unknown stage / cross-tenant) → terminal failed, no reconcile read", async () => {
    const cfg: DbConfig = { setStage: { error: { message: "Unknown journey stage: engaged" } }, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("failed");
    expect(res.error).toContain("Unknown journey stage");
    expect(cfg.queryFilters).toHaveLength(0);
  });

  it("a transport THROW (commit unknown) → ambiguous (reconcile, never a terminal failure)", async () => {
    const cfg: DbConfig = { setStage: { throws: true }, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("ambiguous");
    expect((res.detail as { reason?: string })?.reason).toBe("dispatch_threw");
  });

  it("changed but NO correlation transition → ambiguous (unconfirmed; our write is not proven landed)", async () => {
    const cfg: DbConfig = { setStage: { data: { ok: true, to_stage_slug: "engaged" } }, transitionExists: false, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("ambiguous");
    expect((res.detail as { reason?: string })?.reason).toBe("not_confirmed_by_correlation");
    expect(cfg.queryFilters.some((query) => query.table === "paige_journey_stage_transitions")).toBe(true);
  });

  it("changed but the correlation read ERRORS → ambiguous (canonical_read_error, never a false executed)", async () => {
    const cfg: DbConfig = { setStage: { data: { ok: true, to_stage_slug: "engaged" } }, transitionsError: true, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.dispatch!(baseInput(cfg));
    expect(res.outcome).toBe("ambiguous");
    expect((res.detail as { reason?: string })?.reason).toBe("canonical_read_error");
  });

  it("readback (the reconcile path) confirms by correlation WITHOUT calling set_journey_stage", async () => {
    const cfg: DbConfig = { transitionExists: true, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.readback!(null, baseInput(cfg));
    expect(res.outcome).toBe("executed");
    expect((res.detail as { confirmed_via?: string })?.confirmed_via).toBe("transition_correlation");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false); // NEVER re-dispatches
  });

  it("readback needs NO stage slug — it reconciles from correlation alone (§39 F4 crash-recovery drain)", async () => {
    // args is EMPTY (a crash-recovery drain no longer holds the governed target slug); readback still confirms.
    const cfg: DbConfig = { transitionExists: true, rpcCalls: [], queryFilters: [] };
    const res = await nativeAdapter.readback!(null, baseInput(cfg, { args: {} }));
    expect(res.outcome).toBe("executed");
    const cfg2: DbConfig = { transitionExists: false, rpcCalls: [], queryFilters: [] };
    const res2 = await nativeAdapter.readback!(null, baseInput(cfg2, { args: {} }));
    expect(res2.outcome).toBe("ambiguous"); // no landed transition → ambiguous, never a false failed/executed
  });

  it("dispatch fails CLOSED on a missing stage slug, and on a non-clients subject — WITHOUT calling the RPC", async () => {
    const noSlug: DbConfig = { rpcCalls: [], queryFilters: [] };
    const r1 = await nativeAdapter.dispatch!(baseInput(noSlug, { args: {} }));
    expect(r1.outcome).toBe("failed");
    expect(r1.error).toBe("native_journey_missing_stage_slug");
    expect(noSlug.rpcCalls).toHaveLength(0);

    const badSubject: DbConfig = { rpcCalls: [], queryFilters: [] };
    const r2 = await nativeAdapter.dispatch!(baseInput(badSubject, { subjectTable: "invoices" }));
    expect(r2.outcome).toBe("failed");
    expect(r2.error).toBe("native_journey_subject_not_clients");
    expect(badSubject.rpcCalls).toHaveLength(0);
  });

  it("readStageSlug reads stage_slug / to_stage_slug / slug; rejects blank & non-strings", () => {
    expect(nativeTest.readStageSlug({ stage_slug: "a" })).toBe("a");
    expect(nativeTest.readStageSlug({ to_stage_slug: "b" })).toBe("b");
    expect(nativeTest.readStageSlug({ slug: "c" })).toBe("c");
    expect(nativeTest.readStageSlug({ stage_slug: "  " })).toBeNull();
    expect(nativeTest.readStageSlug({ stage_slug: 5 })).toBeNull();
    expect(nativeTest.readStageSlug(null)).toBeNull();
  });
});

// ═══ Part B — engine phase-3.5 (Gateway) + phase-5 (read-first) integration ══════════════════════════

const event: ClaimedEvent = {
  event_id: "e1", tenant_id: "t1", event_key: "contact.created",
  subject_table: "clients", subject_id: "c1", payload: { source: "web_form" },
};
const journeyAuto = (over: Partial<AutomationRow> = {}): AutomationRow => ({
  id: "a1", name: "Welcome journey", granted_lane: "auto", conditions: [], created_by: "owner1", state: "live", ...over,
});
const journeyActs = { a1: [{ id: "act1", position: 1, action_kind: KIND, tool_key: null, config: { stage_slug: "engaged" } }] };
// The full happy-path config: an eligible actor (tenant tier + admin role), an auto tool lane (→ Gateway
// availability "live"), an auto automation lane, the journey advancing cleanly, and OUR correlation
// transition landing (→ correlation-confirmed executed).
const happy = (over: Partial<DbConfig> = {}): DbConfig => ({
  acts: journeyActs, activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } },
  actorTier: "tenant", actorRoles: ["admin"], toolLane: "auto",
  setStage: { data: { ok: true, to_stage_slug: "engaged", from_stage_slug: "new" } }, transitionExists: true,
  currentActOutcome: null, rpcCalls: [], queryFilters: [], ...over,
});

describe("runEventActs — native auto-execute: Gateway availability gate + phase-5 read-first", () => {
  it("eligible actor + live availability + auto lane → EXECUTED, dispatch stamped by correlation + receipt + Rail", async () => {
    const cfg = happy();
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    const rec = res.records[0];
    expect(rec.adapter_kind).toBe("native");
    expect(rec.outcome).toBe("executed");
    expect(res.by_outcome.executed).toBe(1);
    expect(res.persist_failures).toEqual([]);
    expect(res.reconcile_pending).toEqual([]); // a confirmed executed owes NO reconcile

    // the Gateway was consulted (get_actor_access + resolve_tool_autonomy on the UNDERSCORE tool key) BEFORE dispatch
    expect(cfg.rpcCalls.some((c) => c.fn === "get_actor_access")).toBe(true);
    expect(cfg.rpcCalls.some((c) => c.fn === "resolve_tool_autonomy" && c.args._tool_key === TOOL)).toBe(true);

    // phase 5 wrote a durable accepted_for_execution record BEFORE dispatch, then advanced to executed
    const ledgerWrites = cfg.rpcCalls.filter((c) => c.fn === "paige_record_act_execution");
    expect(ledgerWrites.some((c) => c.args._outcome === "accepted_for_execution" && c.args._dispatched_at == null)).toBe(true);
    const advance = ledgerWrites.find((c) => c.args._dispatched_at != null);
    expect(advance?.args._outcome).toBe("executed");
    expect(advance?.args._settled_at).toBeTruthy();

    // set_journey_stage carried the act's correlation ref; receipt + Rail filed on the confirmed executed
    expect(cfg.rpcCalls.find((c) => c.fn === "set_journey_stage")?.args._source_event).toBe(rec.correlation_ref);
    const receipt = cfg.rpcCalls.find((c) => c.fn === "record_capability_run");
    expect(receipt?.args._capability_key).toBe(TOOL);
    expect(receipt?.args._actor_id).toBe("owner1");
    expect(cfg.rpcCalls.some((c) => c.fn === "record_rail_event")).toBe(true);
  });

  it("a TIER-INELIGIBLE actor (client) → refused at the Gateway availability gate, NEVER dispatched", async () => {
    const cfg = happy({ actorTier: "client" });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("refused_authority");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false); // no dispatch on a refused act
    // no execute plan → phase 5 records the refusal (phase 4 skips ALL native records)
    expect(cfg.rpcCalls.some((c) => c.fn === "paige_record_act_execution" && c.args._outcome === "refused_authority")).toBe(true);
  });

  it("a Gateway role/lane INFRA error → subscriber_retry, records NOTHING (never a false verdict)", async () => {
    for (const gatewayError of ["lane", "role"] as const) {
      const cfg = happy({ gatewayError });
      const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
      expect(res.subscriber_retry, gatewayError).toEqual(["a1"]);
      expect(res.records, gatewayError).toHaveLength(0);
      expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage"), gatewayError).toBe(false);
    }
  });

  it("a tier-read error FAILS CLOSED to client → not_for_tier → refused_authority (safe refuse, never dispatched)", async () => {
    // getActorTier absorbs a get_actor_access error and returns "client" (never widens access), so the
    // Gateway resolves not_for_tier and the act is refused — a safe fail-closed, not a silent execute.
    const cfg = happy({ gatewayError: "tier" });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("refused_authority");
    expect(res.subscriber_retry).toEqual([]);
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false);
  });

  it("IDEMPOTENCY: a re-drain whose ledger row is already terminal (executed) adopts it, does NOT re-dispatch", async () => {
    const cfg = happy({ currentActOutcome: "executed" });   // phase-5 read sees a final row
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("executed");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false); // NEVER a second write
    expect(cfg.rpcCalls.some((c) => c.fn === "record_capability_run")).toBe(false);
  });

  it("RECONCILE: a re-drain whose ledger row is `ambiguous` confirms by correlation readback — NEVER a blind re-dispatch", async () => {
    // The row is ambiguous; OUR correlation transition is present → readback confirms executed, WITHOUT set_journey_stage.
    const cfg = happy({ currentActOutcome: "ambiguous", transitionExists: true });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("executed");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false); // reconcile does NOT re-dispatch
    const advance = cfg.rpcCalls.filter((c) => c.fn === "paige_record_act_execution").find((c) => c.args._dispatched_at != null);
    expect(advance?.args._outcome).toBe("executed");
  });

  it("RECONCILE inconclusive: `ambiguous` row still unconfirmed → stays ambiguous, no dispatch, no receipt (§39 F2 no overwrite), still owes reconcile (§39 F1)", async () => {
    const cfg = happy({ currentActOutcome: "ambiguous", transitionExists: false });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("ambiguous");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false);
    expect(cfg.rpcCalls.some((c) => c.fn === "record_capability_run")).toBe(false);
    expect(res.reconcile_pending).toEqual(["a1"]); // still non-terminal → the event stays reclaimable
  });

  it("an UNCONFIRMED first-drain change → ambiguous: advanced NOT settled, NO receipt/Rail, and OWES a reconcile (§39 F1)", async () => {
    const cfg = happy({ transitionExists: false });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("ambiguous");
    const advance = cfg.rpcCalls.filter((c) => c.fn === "paige_record_act_execution").find((c) => c.args._dispatched_at != null);
    expect(advance?.args._outcome).toBe("ambiguous");
    expect(advance?.args._settled_at).toBeNull(); // ambiguous stays advanceable
    expect(cfg.rpcCalls.some((c) => c.fn === "record_capability_run")).toBe(false);
    // §39 F1: the drainer must be told this subscriber still owes a correlation reconcile, so the event
    // is re-driven (not silently completed `done`) and phase 5 reconciles on a later drain.
    expect(res.reconcile_pending).toEqual(["a1"]);
  });

  it("a definitive dispatch FAILURE → failed (settled), no receipt/Rail", async () => {
    const cfg = happy({ setStage: { error: { message: "Unknown journey stage: engaged" } } });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("failed");
    const advance = cfg.rpcCalls.filter((c) => c.fn === "paige_record_act_execution").find((c) => c.args._dispatched_at != null);
    expect(advance?.args._outcome).toBe("failed");
    expect(advance?.args._settled_at).toBeTruthy();
    expect(cfg.rpcCalls.some((c) => c.fn === "record_capability_run")).toBe(false);
  });

  it("a NO-OP (already at requested stage) → executed + receipt, but the owner Rail is SUPPRESSED (never a new advance)", async () => {
    const cfg = happy({ setStage: { data: { ok: true, unchanged: true, stage_slug: "engaged" } } });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("executed");
    const receipt = cfg.rpcCalls.find((c) => c.fn === "record_capability_run");
    expect(receipt).toBeTruthy();                                     // receipt IS filed (honest)
    expect((receipt?.args._detail as Record<string, unknown>)?.already_at_requested_stage).toBe(true);
    expect(cfg.rpcCalls.some((c) => c.fn === "record_rail_event")).toBe(false); // Rail SUPPRESSED on a no-op
  });

  it("a phase-5 ACCEPTED pre-dispatch write failure → persist_failures, NEVER dispatched (no effect without a durable record)", async () => {
    const cfg = happy({ failAcceptedWrite: true });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.persist_failures).toEqual(["act1"]);
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false); // no dispatch before a durable record
  });

  it("a phase-5 ADVANCE write failure → persist_failures (fail closed), no receipt", async () => {
    const cfg = happy({ failAdvance: true });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.persist_failures).toEqual(["act1"]);
    expect(cfg.rpcCalls.some((c) => c.fn === "record_capability_run")).toBe(false);
  });

  it("a native journey act on a CONFIRM automation lane holds for approval — never dispatches (lane gates before phase 5)", async () => {
    const cfg = happy({ lanes: { a1: { effective: "confirm" } } });
    const res = await runEventActs(mockDb(cfg), event, [journeyAuto()]);
    expect(res.records[0].outcome).toBe("approval_pending");
    expect(cfg.rpcCalls.some((c) => c.fn === "set_journey_stage")).toBe(false);
    expect(cfg.rpcCalls.some((c) => c.fn === "get_actor_access")).toBe(false); // no Gateway resolve on a held lane
    expect(res.reconcile_pending).toEqual([]); // approval_pending is SETTLED (awaiting a human), NOT a reconcile case
  });

  it("a settled non-execute native outcome (tier-refused) owes NO reconcile — only accepted/retrying/ambiguous do", async () => {
    const refused = await runEventActs(mockDb(happy({ actorTier: "client" })), event, [journeyAuto()]);
    expect(refused.records[0].outcome).toBe("refused_authority");
    expect(refused.reconcile_pending).toEqual([]); // a terminal refusal is not reconcilable
    const executed = await runEventActs(mockDb(happy()), event, [journeyAuto()]);
    expect(executed.records[0].outcome).toBe("executed");
    expect(executed.reconcile_pending).toEqual([]); // a confirmed executed is not reconcilable
  });
});

// ═══ Part C — the Gateway resolver (gatherer.ts) ═════════════════════════════════════════════════════

describe("resolveNativeCapabilityStatus — availability resolved THROUGH the canonical Gateway", () => {
  const call = (cfg: DbConfig) => resolveNativeCapabilityStatus(mockDb(cfg), { actorUserId: "u1", tenantId: "t1", actionKind: KIND });

  it("eligible actor + auto tool lane → live", async () => {
    const r = await call({ actorTier: "tenant", actorRoles: ["admin"], toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(r.ok && r.status.availability).toBe("live");
  });

  it("eligible actor + confirm tool lane → needs_approval", async () => {
    const r = await call({ actorTier: "tenant", actorRoles: ["admin"], toolLane: "confirm", rpcCalls: [], queryFilters: [] });
    expect(r.ok && r.status.availability).toBe("needs_approval");
  });

  it("client tier → not_for_tier; non-owner-ops role → not_for_tier", async () => {
    const client = await call({ actorTier: "client", actorRoles: ["admin"], toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(client.ok && client.status.availability).toBe("not_for_tier");
    const noRole = await call({ actorTier: "tenant", actorRoles: [], toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(noRole.ok && noRole.status.availability).toBe("not_for_tier");
    const retiredTitleRole = await call({ actorTier: "tenant", actorRoles: ["coach"], toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(retiredTitleRole.ok && retiredTitleRole.status.availability).toBe("not_for_tier");
  });

  it("authority is the TENANT role (C0a): an admin elsewhere is refused here; a seated owner, the managing agency and the operator are not", async () => {
    // the §59 global-role trap, closed: the global `admin` row no longer admits without a seat HERE
    const adminElsewhere = await call({ actorTier: "tenant", actorRoles: ["admin"], workspaceSeat: false, toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(adminElsewhere.ok && adminElsewhere.status.availability).toBe("not_for_tier");
    // a workspace's own owner needs no global row at all
    const seatedOwner = await call({ actorTier: "tenant", actorRoles: [], workspaceSeat: true, toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(seatedOwner.ok && seatedOwner.status.availability).toBe("live");
    // the agency managing this sub-account
    const agency = await call({ actorTier: "agency", actorRoles: [], workspaceSeat: false, agencyManages: true, toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(agency.ok && agency.status.availability).toBe("live");
    // the Platform Operator (§53) holds no seat and is admitted explicitly
    const operator = await call({ actorTier: "tenant", actorRoles: ["super_admin"], workspaceSeat: false, toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(operator.ok && operator.status.availability).toBe("live");
  });

  it("a role/lane infra error returns {ok:false} (retryable) — never a fabricated verdict", async () => {
    for (const gatewayError of ["lane", "role"] as const) {
      const r = await call({ gatewayError, rpcCalls: [], queryFilters: [] });
      expect(r.ok, gatewayError).toBe(false);
    }
  });

  it("a tier-read error fails closed through getActorTier → client → not_for_tier (a safe refuse, not a false live)", async () => {
    const r = await call({ gatewayError: "tier", actorRoles: ["admin"], toolLane: "auto", rpcCalls: [], queryFilters: [] });
    expect(r.ok && r.status.availability).toBe("not_for_tier");
  });

  it("resolve_tool_autonomy is called with the UNDERSCORE tool key (the dotted-kind ↔ underscore-tool seam)", async () => {
    const cfg: DbConfig = { actorTier: "tenant", actorRoles: ["admin"], toolLane: "auto", rpcCalls: [], queryFilters: [] };
    await resolveNativeCapabilityStatus(mockDb(cfg), { actorUserId: "u1", tenantId: "t1", actionKind: KIND });
    expect(cfg.rpcCalls.some((c) => c.fn === "resolve_tool_autonomy" && c.args._tool_key === TOOL)).toBe(true);
  });

  it("an unbound action_kind (incl. the underscore tool key) returns {ok:false} (never silently available)", async () => {
    const r = await resolveNativeCapabilityStatus(mockDb({ rpcCalls: [], queryFilters: [] }), { actorUserId: "u1", tenantId: "t1", actionKind: "frobnicate" });
    expect(r.ok).toBe(false);
    const rTool = await resolveNativeCapabilityStatus(mockDb({ rpcCalls: [], queryFilters: [] }), { actorUserId: "u1", tenantId: "t1", actionKind: TOOL });
    expect(rTool.ok).toBe(false);
  });
});

// ═══ Part D — registry sync (§39 F5) ═════════════════════════════════════════════════════════════════

describe("native registries stay in sync — no dark executor, no orphan binding (§39 F5)", () => {
  it("the native executor registry and the Gateway capability bindings carry IDENTICAL keys", () => {
    const executorKeys = Object.keys(nativeTest.NATIVE_EXECUTORS).sort();
    const bindingKeys = [...nativeCapabilityBindingKeys()].sort();
    expect(executorKeys).toEqual(bindingKeys);
    // and the C2 vertical is present in both by its dotted action_kind
    expect(executorKeys).toContain(KIND);
    expect(hasNativeCapabilityBinding(KIND)).toBe(true);
  });
});
