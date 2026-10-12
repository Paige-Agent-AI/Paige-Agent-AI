/**
 * Layer C · C5 — the approval-executor (`_shared/paige-orchestration/approve-executor.ts`).
 * Proves the seam that drives a HELD (approval_pending) native act to execution on a human's approval, plus
 * the RESUME/RECOVERY paths the Codex peer-gate required:
 *   • happy path: approval_pending → redeem via the dedicated approve RPC → native dispatch → ledger executed;
 *   • IMMUTABLE ARGS (§P1): the args + action_kind come from the ledger's own snapshot, NEVER a mutated act config;
 *   • idempotent/honest: a non-resumable (terminal) row dispatches NOTHING and reports the persisted truth;
 *   • fail-closed: an n8n-sourced held act is not-supported-in-slice (never fired); a governed refusal and a
 *     tenant-integrity / tenant-authorization mismatch STOP before redeeming (nothing consumed, nothing dispatched);
 *   • LEDGER-WRITE HONESTY (§P3): a durable-advance write failure reports the PRIOR persisted state, never the
 *     adapter outcome, so the caller cannot consume an outcome the ledger never recorded;
 *   • RESUME (§P3/§P4): an accepted_for_execution row (redeemed, unadvanced) reconciles by correlation or
 *     re-dispatches; an ambiguous row reconciles by correlation ONLY (never blind re-dispatch) and, still
 *     unconfirmed, consumes nothing.
 * The Gateway availability resolver is injected (test-only; production always uses the canonical Gateway).
 */
import { stableRunId } from "../../supabase/functions/_shared/capability-record.ts";
import { actReceiptRunSeed } from "../../supabase/functions/_shared/paige-orchestration/outcomes.ts";
import { describe, it, expect } from "vitest";
import {
  executeApprovedLayerCAct,
  type ApproveExecutorDb,
  type ApproveExecInput,
 approvalRefusalMessage } from "../../supabase/functions/_shared/paige-orchestration/approve-executor.ts";

// ── A chainable, thenable mock of the supabase-js surface the executor + native adapter use. ────────────
type Rows = Record<string, unknown[]>;
type Cfg = {
  rows: Rows;                                   // table → rows returned by a select
  rpc: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>;
  calls: { rpc: Array<{ fn: string; args: Record<string, unknown> }> };
};
// A chainable, thenable stand-in for the supabase-js query builder. Deliberately structural: the executor
// only ever selects/eq/order/limit then awaits, so the mock resolves the table's seeded rows.
type QueryResult = { data: unknown[]; error: null };
type QueryMock = {
  select: () => QueryMock;
  eq: () => QueryMock;
  order: () => QueryMock;
  limit: () => QueryMock;
  then: <R1, R2>(onF: (v: QueryResult) => R1, onR: (e: unknown) => R2) => Promise<R1 | R2>;
};
function mockDb(cfg: Cfg): ApproveExecutorDb {
  const makeQuery = (table: string): QueryMock => {
    const q: QueryMock = {
      select() { return q; },
      eq() { return q; },
      order() { return q; },
      limit() { return q; },
      then(onF, onR) {
        return Promise.resolve<QueryResult>({ data: cfg.rows[table] ?? [], error: null }).then(onF, onR);
      },
    };
    return q;
  };
  // The executor consumes this through the real ApproveExecutorDb type; the double stands in at that boundary.
  return {
    from: (t: string) => makeQuery(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      cfg.calls.rpc.push({ fn, args });
      const h = cfg.rpc[fn];
      if (h) return h(args);
      return { data: null, error: null }; // best-effort telemetry rpcs (record_capability_run/record_rail_event/…)
    },
  } as unknown as ApproveExecutorDb;
}

const liveAvailability = () => Promise.resolve({ ok: true as const, status: { availability: "live" as const } });

// A native held act (crm.advance_journey_stage) at approval_pending, tenant-consistent, with the IMMUTABLE
// governed-args snapshot the engine writes into the ledger detail at approval_pending time (§P1).
const baseCfg = (over: Partial<Cfg["rows"]> = {}, rpcOver: Partial<Cfg["rpc"]> = {}): Cfg => ({
  calls: { rpc: [] },
  rows: {
    paige_act_executions: [{
      outcome: "approval_pending", capability_key: "crm.advance_journey_stage",
      correlation_ref: "corr-1", idempotency_key: "corr-1", tenant_id: "t1", automation_id: "a1", act_position: 1,
      detail: { snapshot_args: { stage_slug: "engaged" } },
    }],
    paige_automation_acts: [{ action_kind: "crm.advance_journey_stage", config: { stage_slug: "engaged" } }],
    paige_native_events: [{ subject_table: "clients", subject_id: "c1", tenant_id: "t1" }],
    paige_automations: [{ name: "Welcome flow" }],
    paige_journey_stage_transitions: [{ id: "tr1", to_stage_slug: "engaged" }], // the reconcile confirmation
    ...over,
  },
  rpc: {
    // the process's CURRENT posture, re-read at approval (§68): live + confirm by default
    resolve_automation_autonomy: () => ({ data: { found: true, state: "live", effective: "confirm" }, error: null }),
    paige_approve_act_execution: () => ({ data: { outcome: "accepted_for_execution" }, error: null }),
    set_journey_stage: () => ({ data: { unchanged: false }, error: null }), // changed → reconcile by correlation
    paige_record_act_execution: (a: Record<string, unknown>) => ({ data: { id: "row1", outcome: a._outcome }, error: null }),
    ...rpcOver,
  },
});

const run = (cfg: Cfg, over: Record<string, unknown> = {}) =>
  executeApprovedLayerCAct({ db: mockDb(cfg), eventId: "e1", actId: "act1", approverUserId: "u1", expectedTenantId: "t1", resolveAvailability: liveAvailability as unknown as ApproveExecInput["resolveAvailability"], ...over });

describe("approve-executor — the process is re-read at approval (§68, INT-179)", () => {
  const posture = (p: Record<string, unknown> | null, error: unknown = null) =>
    ({ resolve_automation_autonomy: () => ({ data: p, error }) });
  const refusedWith = async (rpcOver: Record<string, unknown>, reason: string) => {
    const cfg = baseCfg({}, rpcOver as Partial<Cfg["rpc"]>);
    const res = await run(cfg);
    expect(res.executed).toBe(false);
    expect(res.reason).toBe(reason);
    expect(res.outcome).toBe("approval_pending");                 // nothing redeemed; stays reclaimable
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("paige_approve_act_execution");
    expect(fns).not.toContain("set_journey_stage");
    expect(fns).not.toContain("paige_record_act_execution");
  };

  it("a paused process does not run on approval", () =>
    refusedWith(posture({ found: true, state: "paused", effective: "confirm" }), "process_not_live"));
  it("a process turned off does not run on approval", () =>
    refusedWith(posture({ found: true, state: "live", effective: "off" }), "process_lane_off"));
  it("a trust ceiling of 0 (Observe) does not run on approval", () =>
    refusedWith(posture({ found: true, state: "live", effective: "off", capped_by: "ceiling", rung: 0 }), "platform_observe_only"));
  it("a deleted process does not run on approval", () =>
    refusedWith(posture({ found: false }), "process_not_found"));
  it("a posture read failure fails closed", () =>
    refusedWith(posture(null, { message: "boom" }), "process_posture_read_error"));
  it("an auto process still runs on approval", async () => {
    const cfg = baseCfg({}, posture({ found: true, state: "live", effective: "auto" }) as Partial<Cfg["rpc"]>);
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
  });
  it("tells the owner what happened and that the approval waits, never a raw code", () => {
    expect(approvalRefusalMessage("process_not_live")).toMatch(/paused/);
    expect(approvalRefusalMessage("process_lane_off")).toMatch(/turned off/);
    expect(approvalRefusalMessage("platform_observe_only")).toMatch(/observe only/);
    expect(approvalRefusalMessage("governed_capability_not_for_tier")).toMatch(/owner or an admin/);
    for (const r of ["process_not_live", "process_lane_off", "platform_observe_only", "something_new", undefined]) {
      expect(approvalRefusalMessage(r)).not.toMatch(/_/);   // no snake_case code reaches the owner
    }
  });
  it("re-reads the posture of the held act's OWN process", async () => {
    const cfg = baseCfg();
    await run(cfg);
    const call = cfg.calls.rpc.find((c) => c.fn === "resolve_automation_autonomy")!;
    expect(call.args._automation_id).toBe("a1");
  });
  it("an accepted-but-never-landed resume is gated too", async () => {
    const cfg = baseCfg({
      paige_act_executions: [{
        outcome: "accepted_for_execution", capability_key: "crm.advance_journey_stage",
        correlation_ref: "corr-1", idempotency_key: "corr-1", tenant_id: "t1", automation_id: "a1", act_position: 1,
        detail: { snapshot_args: { stage_slug: "engaged" } },
      }],
      paige_journey_stage_transitions: [], // never landed
    }, posture({ found: true, state: "paused", effective: "confirm" }) as Partial<Cfg["rpc"]>);
    const res = await run(cfg);
    expect(res.reason).toBe("process_not_live");
    expect(res.outcome).toBe("accepted_for_execution");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });
});

describe("approve-executor — happy path: a held native act is redeemed, dispatched, and executed", () => {
  it("redeems via the approve RPC, dispatches the native adapter, advances the ledger to executed", async () => {
    const cfg = baseCfg();
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    expect(res.executed).toBe(true);
    expect(res.ok).toBe(true);
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).toContain("paige_approve_act_execution"); // the single sanctioned transition was invoked
    expect(fns).toContain("set_journey_stage");           // the native dispatch actually ran
    const finalWrite = cfg.calls.rpc.filter((c) => c.fn === "paige_record_act_execution").at(-1)!;
    expect(finalWrite.args._outcome).toBe("executed");    // ledger advanced to executed
    expect(finalWrite.args._settled_at).toBeTruthy();
  });

  it("files the capability receipt under the governed capability id, not the ledger's dotted action-kind", async () => {
    // record_capability_run accepts only ^[a-z][a-z0-9_]{1,63}$ (20270107000000:116). The ledger snapshots the
    // dotted action-bus slug (crm.advance_journey_stage); a receipt filed under it is refused and, being
    // best-effort, silently lost. The engine's auto path files under capability.id; the approve path must too.
    const cfg = baseCfg();
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    const receipt = cfg.calls.rpc.find((c) => c.fn === "record_capability_run");
    expect(receipt).toBeTruthy();
    expect(receipt!.args._capability_key).toBe("crm_advance_journey_stage");
    expect(String(receipt!.args._capability_key)).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    // the ledger keeps its own immutable action-kind snapshot
    const finalWrite = cfg.calls.rpc.filter((c) => c.fn === "paige_record_act_execution").at(-1)!;
    expect(finalWrite.args._capability_key).toBe("crm.advance_journey_stage");
    // one receipt per act: the same run id the engine's auto path derives for this (event, act)
    expect(receipt!.args._run_id).toBe(await stableRunId(actReceiptRunSeed("e1", "act1")));
  });

  it("dispatches the IMMUTABLE ledger snapshot args, NOT a mutated live act config (§P1)", async () => {
    // the reviewer approved stage_slug "engaged" (snapshot); a tenant admin then mutated the act config.
    const cfg = baseCfg({ paige_automation_acts: [{ action_kind: "crm.advance_journey_stage", config: { stage_slug: "MUTATED" } }] });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    const dispatch = cfg.calls.rpc.find((c) => c.fn === "set_journey_stage")!;
    expect(dispatch.args._stage_slug).toBe("engaged");    // the SNAPSHOT, never the mutated live config
  });

  it("falls back to the live act config only when the ledger snapshot is absent (backward-compat)", async () => {
    const cfg = baseCfg({
      paige_act_executions: [{
        outcome: "approval_pending", capability_key: "crm.advance_journey_stage",
        correlation_ref: "corr-1", idempotency_key: "corr-1", tenant_id: "t1", automation_id: "a1", act_position: 1,
        detail: {}, // no snapshot_args
      }],
      paige_automation_acts: [{ action_kind: "crm.advance_journey_stage", config: { stage_slug: "fallback" } }],
    });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    const dispatch = cfg.calls.rpc.find((c) => c.fn === "set_journey_stage")!;
    expect(dispatch.args._stage_slug).toBe("fallback");
  });

  it("a no-op advance (already on target stage) still executes, and suppresses the 'advanced' Rail", async () => {
    const cfg = baseCfg({}, { set_journey_stage: () => ({ data: { unchanged: true }, error: null }) });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    expect((res.detail as Record<string, unknown>).already_at_requested_stage).toBe(true);
    // no record_rail_event on an idempotent no-op
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("record_rail_event");
  });
});

describe("approve-executor — fail-closed + honest (nothing consumed, nothing dispatched)", () => {
  it("a terminal (executed) row dispatches nothing and reports the persisted outcome", async () => {
    const cfg = baseCfg({ paige_act_executions: [{ outcome: "executed", capability_key: "crm.advance_journey_stage", correlation_ref: "c", idempotency_key: "c", tenant_id: "t1", automation_id: "a1", act_position: 1, detail: {} }] });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    expect(res.reason).toBe("not_pending_approval");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });

  it("an n8n-sourced held act is NOT supported in this slice and is never fired", async () => {
    const cfg = baseCfg({ paige_act_executions: [{ outcome: "approval_pending", capability_key: "n8n_run_workflow", correlation_ref: "c", idempotency_key: "c", tenant_id: "t1", automation_id: "a1", act_position: 1, detail: {} }] });
    const res = await run(cfg);
    expect(res.outcome).toBe("approval_pending");
    expect(res.reason).toBe("not_supported_in_slice");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
  });

  it("a TENANT-AUTHORIZATION mismatch (caller authorised for a different tenant) STOPS before redeeming (§9/§59)", async () => {
    const cfg = baseCfg();
    const res = await run(cfg, { expectedTenantId: "OTHER" }); // ledger tenant is t1; caller authorised for OTHER
    expect(res.outcome).toBe("approval_pending");
    expect(res.reason).toBe("tenant_authorization_mismatch");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });

  it("a MISSING authorised tenant fails closed — the executor never acts without knowing the authorised tenant (§59)", async () => {
    const cfg = baseCfg();
    const res = await run(cfg, { expectedTenantId: null });
    expect(res.reason).toBe("tenant_authorization_mismatch");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
  });

  it("a tenant mismatch on a foreign TERMINAL row does NOT echo its outcome (no cross-tenant disclosure, not consumed) (§39/§9/§13)", async () => {
    // A crafted approval in tenant OTHER points at tenant t1's already-EXECUTED act. The guard must not leak
    // t1's terminal outcome (§9) and must return a non-terminal the execute-approval `executed|failed` gate will
    // NOT consume as an attempt (§13) — otherwise the crafted approval gets stamped `approved`.
    const cfg = baseCfg({ paige_act_executions: [{ outcome: "executed", capability_key: "crm.advance_journey_stage", correlation_ref: "c", idempotency_key: "c", tenant_id: "t1", automation_id: "a1", act_position: 1, detail: {} }] });
    const res = await run(cfg, { expectedTenantId: "OTHER" });
    expect(res.reason).toBe("tenant_authorization_mismatch");
    expect(res.outcome).not.toBe("executed");   // the foreign terminal state is NOT disclosed
    expect(res.executed).toBe(false);            // never consumed as a real attempt by the caller
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });

  it("a tenant-integrity mismatch (event tenant ≠ ledger tenant) STOPS before redeeming", async () => {
    const cfg = baseCfg({ paige_native_events: [{ subject_table: "clients", subject_id: "c1", tenant_id: "OTHER" }] });
    const res = await run(cfg);
    expect(res.outcome).toBe("approval_pending");
    expect(res.reason).toBe("tenant_integrity_mismatch");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
  });

  it("a governed refusal (unavailable capability) STOPS before redeeming — nothing consumed", async () => {
    const notForTier = () => Promise.resolve({ ok: true as const, status: { availability: "not_for_tier" as const } });
    const cfg = baseCfg();
    const res = await run(cfg, { resolveAvailability: notForTier });
    expect(res.outcome).toBe("approval_pending");
    expect(res.reason?.startsWith("governed_")).toBe(true);
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });

  it("an availability infra error STOPS (retryable), never a false refusal or execution", async () => {
    const infra = () => Promise.resolve({ ok: false as const, error: "gateway_down" });
    const cfg = baseCfg();
    const res = await run(cfg, { resolveAvailability: infra });
    expect(res.reason).toBe("availability_infra_error");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("paige_approve_act_execution");
  });

  it("a durable ledger-write FAILURE after dispatch reports the PRIOR persisted state, never the adapter outcome (§P3)", async () => {
    // the act dispatched (executed) but the terminal ledger advance write fails — the row is still accepted.
    const cfg = baseCfg({}, { paige_record_act_execution: () => ({ data: null, error: { message: "db_down" } }) });
    const res = await run(cfg);
    expect(res.outcome).toBe("accepted_for_execution"); // the TRUE persisted state, not "executed"
    expect(res.executed).toBe(false);
    expect(res.reason).toBe("ledger_write_failed");
    expect((res.detail as Record<string, unknown>).attempted_outcome).toBe("executed"); // traceable, but not consumed by the caller
  });
});

describe("approve-executor — already-redeemed (concurrency): the approve RPC terminal is detected, not re-dispatched", () => {
  it("when the approve RPC returns a terminal outcome, the executor stops and reports it (no dispatch)", async () => {
    const cfg = baseCfg({}, { paige_approve_act_execution: () => ({ data: { outcome: "executed" }, error: null }) });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    expect(res.executed).toBe(true);
    expect(res.reason).toBe("already_redeemed");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage"); // never re-dispatched
  });
});

describe("approve-executor — RESUME (recovery): a redeemed-but-unadvanced / unconfirmed row reconciles, never re-redeems", () => {
  const accepted = (over: Partial<Cfg["rows"]> = {}, rpcOver: Partial<Cfg["rpc"]> = {}) => baseCfg({
    paige_act_executions: [{
      outcome: "accepted_for_execution", capability_key: "crm.advance_journey_stage",
      correlation_ref: "corr-1", idempotency_key: "corr-1", tenant_id: "t1", automation_id: "a1", act_position: 1,
      detail: { snapshot_args: { stage_slug: "engaged" } },
    }],
    ...over,
  }, rpcOver);
  const ambiguous = (over: Partial<Cfg["rows"]> = {}, rpcOver: Partial<Cfg["rpc"]> = {}) => baseCfg({
    paige_act_executions: [{
      outcome: "ambiguous", capability_key: "crm.advance_journey_stage",
      correlation_ref: "corr-1", idempotency_key: "corr-1", tenant_id: "t1", automation_id: "a1", act_position: 1,
      detail: { snapshot_args: { stage_slug: "engaged" } },
    }],
    ...over,
  }, rpcOver);

  it("accepted_for_execution + a landed transition → reconciled to executed WITHOUT re-redeeming or re-dispatching", async () => {
    const cfg = accepted(); // transitions present → readback confirms
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("paige_approve_act_execution"); // NOT re-redeemed (authorisation already happened)
    expect(fns).not.toContain("set_journey_stage");           // readback confirmed — no re-dispatch
    expect(cfg.calls.rpc.filter((c) => c.fn === "paige_record_act_execution").at(-1)!.args._outcome).toBe("executed");
  });

  it("accepted_for_execution + NO landed transition → RE-DISPATCHES (idempotent), never re-redeems", async () => {
    const cfg = accepted({ paige_journey_stage_transitions: [] }, { set_journey_stage: () => ({ data: { unchanged: true }, error: null }) });
    const res = await run(cfg);
    expect(res.outcome).toBe("executed"); // re-dispatch → idempotent no-op → executed
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("paige_approve_act_execution"); // NOT re-redeemed
    expect(fns).toContain("set_journey_stage");               // re-dispatched
  });

  it("§68: accepted_for_execution + NO landed transition + availability REVOKED → STOPS the re-dispatch (never blind re-fires)", async () => {
    // The narrow §68 window: authority/availability was revoked AFTER redemption but BEFORE the effect landed.
    // The re-dispatch must re-run the availability+governed gate and DECLINE rather than fire an effect the
    // current posture forbids. The row stays accepted_for_execution → the caller consumes nothing → recoverable.
    const notForTier = () => Promise.resolve({ ok: true as const, status: { availability: "not_for_tier" as const } });
    const cfg = accepted({ paige_journey_stage_transitions: [] });
    const res = await run(cfg, { resolveAvailability: notForTier });
    expect(res.outcome).toBe("accepted_for_execution"); // stays recoverable — NOT executed, NOT approval_pending
    expect(res.executed).toBe(false);
    expect(res.reason?.startsWith("governed_")).toBe(true);
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("set_journey_stage");            // the effect was NOT re-fired
    expect(fns).not.toContain("paige_approve_act_execution");  // never re-redeemed
  });

  it("§68: accepted_for_execution + NO landed transition + availability INFRA error → STOPS (retryable), no re-fire", async () => {
    const infra = () => Promise.resolve({ ok: false as const, error: "gateway_down" });
    const cfg = accepted({ paige_journey_stage_transitions: [] });
    const res = await run(cfg, { resolveAvailability: infra });
    expect(res.outcome).toBe("accepted_for_execution");
    expect(res.reason).toBe("availability_infra_error");
    expect(cfg.calls.rpc.map((c) => c.fn)).not.toContain("set_journey_stage");
  });

  it("ambiguous + a landed transition → reconciled to executed by correlation, never re-dispatched", async () => {
    const cfg = ambiguous(); // transitions present → readback confirms
    const res = await run(cfg);
    expect(res.outcome).toBe("executed");
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("paige_approve_act_execution");
    expect(fns).not.toContain("set_journey_stage"); // ambiguous is NEVER blind re-dispatched (owner rule)
  });

  it("ambiguous + still unconfirmed → reports reconcile_unconfirmed, consumes NOTHING, never dispatches", async () => {
    const cfg = ambiguous({ paige_journey_stage_transitions: [] }); // readback still finds nothing
    const res = await run(cfg);
    expect(res.outcome).toBe("ambiguous");
    expect(res.executed).toBe(false);
    expect(res.reason).toBe("reconcile_unconfirmed");
    const fns = cfg.calls.rpc.map((c) => c.fn);
    expect(fns).not.toContain("paige_approve_act_execution");
    expect(fns).not.toContain("set_journey_stage");
  });
});
