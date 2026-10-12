/**
 * Layer C — the connector-neutral governed event→act engine (`_shared/paige-orchestration/engine.ts`).
 * Proves: (1) buildGovernedInputs shapes the ONE-pathway inputs correctly and the PERSON attribution
 * unblocks an `auto` mutation while a SERVICE principal is refused (governedExecution.ts:188-193);
 * (2) outcomeFromDecision maps execute/propose/refuse to the exact per-act outcome; (3) runEventActs
 * records the exact per-act outcome for every branch (condition/lane/auth/adapter) via a mock DB, writing
 * through the atomic/monotonic RPC with a durable idempotency/correlation record — never a blanket flag;
 * (4) FAIL-CLOSED persistence — a failed ledger write surfaces in `persist_failures` (owner correction #3);
 * (5) the engine reports the outcome the RPC ACTUALLY persisted, not its recomputed guess (monotonic, §13).
 */
import { describe, it, expect } from "vitest";
import {
  buildGovernedInputs,
  outcomeFromDecision,
  runEventActs,
  type ClaimedEvent,
  type AutomationRow,
  type EngineDb,
} from "../../supabase/functions/_shared/paige-orchestration/engine.ts";
import { decideGovernedExecution } from "../../supabase/functions/_shared/paige-spine/governedExecution.ts";

describe("buildGovernedInputs — the one-pathway inputs, and person-attribution of an auto grant", () => {
  it("shapes an automation-door, server-tenant, person-principal caller with the lane passed through", () => {
    const inputs = buildGovernedInputs({
      tenantId: "t1", personUserId: "u1", effectiveLane: "auto",
      capability: { id: "crm_create_contact", effect: "mutate", outcomeChannel: "paige_act_executions" },
      actConfig: { a: 1 },
    });
    expect(inputs.caller.door).toBe("automation");
    expect(inputs.caller.principal).toBe("person");
    expect(inputs.caller.tenantSource).toBe("server");
    expect(inputs.caller.userId).toBe("u1");
    expect(inputs.caller.access).toEqual({ allowed: true });
    expect(inputs.capability.effect).toBe("mutate");
    // a mutation must carry a non-empty outcome channel (the seam enforces it)
    expect((inputs.capability as { outcomeChannel?: string }).outcomeChannel).toBeTruthy();
    expect(inputs.approval.autonomyLane).toBe("auto");
    expect((inputs.approval as { claimedArgs?: unknown }).claimedArgs).toBeUndefined();
  });

  it("PERSON + auto lets a classified mutation EXECUTE; a SERVICE principal is refused (why we attribute the person)", () => {
    const cap = { id: "crm_create_contact", effect: "mutate" as const, outcomeChannel: "paige_act_executions" };
    const personDecision = decideGovernedExecution(
      buildGovernedInputs({ tenantId: "t1", personUserId: "u1", effectiveLane: "auto", capability: cap, actConfig: {} }),
    );
    expect(personDecision.kind).toBe("execute");

    // the same act as a service principal (no person behind it) must NOT execute — this is exactly the
    // guard that forces the engine to resolve the authorizing person for an auto grant.
    const serviceInputs = buildGovernedInputs({
      tenantId: "t1", personUserId: "u1", effectiveLane: "auto", capability: cap, actConfig: {},
    });
    serviceInputs.caller.principal = "service";
    serviceInputs.caller.userId = null;
    const serviceDecision = decideGovernedExecution(serviceInputs);
    expect(serviceDecision.kind).not.toBe("execute");
  });
});

describe("outcomeFromDecision — exact per-act outcome, never a success on a non-execute", () => {
  const audit = { risk: "high" } as never;
  it("execute → accepted_for_execution (C1); propose → approval_pending; refuse → refused_*", () => {
    expect(outcomeFromDecision({ kind: "execute", args: { x: 1 }, risk: "high", audit }).outcome)
      .toBe("accepted_for_execution");
    expect(outcomeFromDecision({ kind: "propose", revalidate: false, risk: "high", audit }).outcome)
      .toBe("approval_pending");
    const refused = outcomeFromDecision(
      { kind: "refuse", code: "access_denied", message: "no", reason: null, risk: "high", audit },
    );
    expect(refused.outcome).toBe("refused_authority");
    expect(refused.refusalCode).toBe("access_denied");
  });
});

// ── A minimal chainable, thenable mock of the supabase-js surface the engine uses. ─────────────────────
type MockConfig = {
  acts: Record<string, Array<{ id: string; position: number; action_kind: string | null; tool_key: string | null; config: unknown; created_at?: string }>>;
  activeMembers: Set<string>;                       // `${tenantId}:${userId}`
  lanes: Record<string, { effective: string }>;
  recorded: Array<Record<string, unknown>>;         // every paige_record_act_execution call the engine made
  persistFail?: Set<string>;                        // act_ids whose durable ledger write should fail
  persistOutcomeOverride?: Record<string, string>;  // act_id → the outcome the RPC actually persisted (monotonic)
  fromErrors?: Set<string>;                         // table names whose READ returns an infra error
  laneError?: boolean;                              // resolve_automation_autonomy returns an infra error
  ledgerActs?: Array<{ event_id: string; automation_id: string; act_id: string }>; // existing ledger rows
};
function mockDb(cfg: MockConfig): EngineDb {
  const makeQuery = (table: string) => {
    const state: Record<string, unknown> = {};
    const q: any = {
      _table: table,
      select() { return q; },
      order() { return q; },
      eq(k: string, v: unknown) { state[k] = v; return q; },
      limit() { return q; },
      then(onF: any, onR: any) {
        if (cfg.fromErrors?.has(table)) {
          return Promise.resolve({ data: null, error: { message: `${table}_read_failed` } }).then(onF, onR);
        }
        let data: unknown = [];
        if (table === "paige_automation_acts") data = cfg.acts[state.automation_id as string] ?? [];
        else if (table === "paige_act_executions") {
          data = (cfg.ledgerActs ?? []).filter((r) => r.event_id === state.event_id && r.automation_id === state.automation_id);
        }
        else if (table === "tenant_members") {
          data = cfg.activeMembers.has(`${state.tenant_id}:${state.user_id}`) ? [{ user_id: state.user_id }] : [];
        }
        return Promise.resolve({ data, error: null }).then(onF, onR);
      },
    };
    return q;
  };
  return {
    from: (t: string) => makeQuery(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "resolve_automation_autonomy") {
        if (cfg.laneError) return { data: null, error: { message: "resolve_automation_autonomy_failed" } };
        return { data: cfg.lanes[args._automation_id as string] ?? { effective: "off" }, error: null };
      }
      if (fn === "paige_record_act_execution") {
        cfg.recorded.push(args);
        const actId = args._act_id as string;
        if (cfg.persistFail?.has(actId)) return { data: null, error: { message: "ledger_write_failed" } };
        // echo the row that PERSISTED — the monotonic RPC may hand back a different outcome than requested
        const outcome = cfg.persistOutcomeOverride?.[actId] ?? (args._outcome as string);
        return { data: { id: `row-${actId}`, outcome, ...args }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const event: ClaimedEvent = {
  event_id: "e1", tenant_id: "t1", event_key: "contact.created",
  subject_table: "clients", subject_id: "c1", payload: { source: "web_form" },
};
const auto = (over: Partial<AutomationRow>): AutomationRow => ({
  id: "a1", name: "n", granted_lane: "auto", conditions: [], created_by: "owner1", state: "live", ...over,
});

describe("runEventActs — the exact per-act outcome for every branch", () => {
  it("condition_not_matched when the automation's conditions exclude the event", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event,
      [auto({ conditions: [{ field: "source", op: "eq", value: "referral" }] })]);
    expect(res.records[0].outcome).toBe("condition_not_matched");
    expect(cfg.recorded).toHaveLength(1);
    expect(cfg.recorded[0]._outcome).toBe("condition_not_matched");
    expect(res.persist_failures).toEqual([]);
  });

  it("held_by_lane when the effective lane is off", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "off" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.records[0].outcome).toBe("held_by_lane");
  });

  it("approval_pending when the effective lane is confirm", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "confirm" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.records[0].outcome).toBe("approval_pending");
  });

  it("a HELD (confirm-lane) act SNAPSHOTS its governed args into the IMMUTABLE ledger detail (§P1, Codex peer-gate)", async () => {
    // The approval-executor must dispatch what the reviewer approved — never the live, mutable act config. The
    // engine captures the args into detail.snapshot_args at approval_pending time so the executor reads the snapshot.
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: { webhook_path: "hook", foo: "bar" } }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "confirm" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.records[0].outcome).toBe("approval_pending");
    expect((res.records[0].detail as Record<string, unknown>).snapshot_args).toEqual({ webhook_path: "hook", foo: "bar" });
    // and it is DURABLY PERSISTED (an n8n record persists in phase 4), so the executor can read it back later.
    expect((cfg.recorded[0]._detail as Record<string, unknown>).snapshot_args).toEqual({ webhook_path: "hook", foo: "bar" });
  });

  it("auto + person + n8n (a HIGH external-effect act) → approval_pending: high requires approval, not auto-run, with a durable correlation record", async () => {
    // n8n_run_workflow is classified `high` (action-risk.ts). The governed seam requires a human yes for a
    // high act even on an `auto` lane — true auto-execution of a high act needs the RE-2 standing-grant lift
    // (dark), never the lane alone. So the reference vertical (contact.created → n8n) correctly HOLDS for
    // approval here rather than firing unattended — exactly the owner's "autonomy is bounded / fail closed".
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: { webhook_path: "x" } }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    const rec = res.records[0];
    expect(rec.adapter_kind).toBe("n8n");           // connector-neutral routing to the n8n adapter
    expect(rec.outcome).toBe("approval_pending");   // high act on auto → held for approval, not executed
    expect(rec.idempotency_key.length).toBeGreaterThan(0);
    expect(rec.correlation_ref).toBe(rec.idempotency_key);  // durable correlation record
    expect(cfg.recorded[0]._outcome).toBe("approval_pending"); // the exact outcome is persisted, not a blanket flag
    expect(cfg.recorded[0]._idempotency_key).toBe(rec.idempotency_key);
  });

  it("auto + NO active authorizing person → refused_authority (fail closed), never executed", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(), lanes: { a1: { effective: "auto" } }, recorded: [], // owner1 not active
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.records[0].outcome).toBe("refused_authority");
    expect(res.records[0].refusal_code).toBe("no_authorizing_person");
  });

  it("auto + unsupported adapter → failed (unsupported_adapter), fail closed", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "frobnicate_thing", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } }, recorded: [],
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.records[0].adapter_kind).toBe("unsupported");
    expect(res.records[0].outcome).toBe("failed");
    expect(res.records[0].error).toBe("unsupported_adapter");
  });
});

describe("runEventActs — a recovery re-open governs only acts that existed when the event happened (Slice 2b)", () => {
  const cfg = (): MockConfig => ({
    acts: { a1: [
      { id: "old", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {}, created_at: "2026-10-01T00:00:00Z" },
      { id: "late", position: 2, action_kind: "n8n_run_workflow", tool_key: null, config: {}, created_at: "2026-10-03T00:00:00Z" },
    ] },
    activeMembers: new Set(), lanes: { a1: { effective: "confirm" } }, recorded: [],
  });
  it("with the cutoff, an act added after the event is never governed or recorded", async () => {
    const c = cfg();
    const r = await runEventActs(mockDb(c), event, [auto({})], { actsCreatedAtOrBefore: "2026-10-02T00:00:00Z" });
    expect(r.records.map((x) => x.act_id)).toEqual(["old"]);
    expect(c.recorded.map((x) => x._act_id)).toEqual(["old"]);
  });
  it("an act added after the event that the first drain already governed (and stranded) is still recovered", async () => {
    const c = cfg();
    c.ledgerActs = [{ event_id: "e1", automation_id: "a1", act_id: "late" }];
    const r = await runEventActs(mockDb(c), event, [auto({})], { actsCreatedAtOrBefore: "2026-10-02T00:00:00Z" });
    expect(r.records.map((x) => x.act_id)).toEqual(["old", "late"]);
  });
  it("a failed ledger read during a recovery drain retries the subscriber, never governs blind", async () => {
    const c = cfg(); c.fromErrors = new Set(["paige_act_executions"]);
    const r = await runEventActs(mockDb(c), event, [auto({})], { actsCreatedAtOrBefore: "2026-10-02T00:00:00Z" });
    expect(r.subscriber_retry).toEqual(["a1"]);
    expect(r.records).toEqual([]);
  });
  it("without it (a normal event) every configured act is governed, as before", async () => {
    const r = await runEventActs(mockDb(cfg()), event, [auto({})]);
    expect(r.records.map((x) => x.act_id)).toEqual(["old", "late"]);
  });
});

describe("runEventActs — fail-closed persistence + monotonic outcome surfacing (owner corrections #3/#4)", () => {
  it("a FAILED ledger write surfaces the act_id in persist_failures (never silently 'done')", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "confirm" } }, recorded: [],
      persistFail: new Set(["act1"]),
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(cfg.recorded).toHaveLength(1);                 // the write was ATTEMPTED
    expect(res.persist_failures).toEqual(["act1"]);       // and its failure is surfaced, not swallowed
  });

  it("reports the outcome the RPC ACTUALLY persisted, not the recomputed guess (monotonic: a re-drain hitting a final row)", async () => {
    // The engine re-derives `approval_pending`, but the monotonic RPC returns an already-persisted terminal
    // `executed` (a prior run settled it). The engine must report the PERSISTED truth (§13), not its guess.
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "confirm" } }, recorded: [],
      persistOutcomeOverride: { act1: "executed" },
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(cfg.recorded[0]._outcome).toBe("approval_pending"); // what it TRIED to write
    expect(res.records[0].outcome).toBe("executed");           // what actually persisted, and what it reports
    expect(res.by_outcome.executed).toBe(1);
  });
});

describe("runEventActs — infra read/resolve errors RETRY, never a false terminal outcome (§13/§32, verifier F2)", () => {
  it("an act-LOAD error → subscriber_retry, records NOTHING (never a silent 'no acts' completion)", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } }, recorded: [],
      fromErrors: new Set(["paige_automation_acts"]),
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.subscriber_retry).toEqual(["a1"]);
    expect(res.records).toHaveLength(0);        // no false condition_not_matched / held_by_lane / refused
    expect(cfg.recorded).toHaveLength(0);       // and nothing was persisted
  });

  it("a LANE-resolve error → subscriber_retry, never a false held_by_lane (which is FINAL)", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: {}, recorded: [], laneError: true,
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.subscriber_retry).toEqual(["a1"]);
    expect(res.records).toHaveLength(0);
    expect(res.by_outcome.held_by_lane ?? 0).toBe(0);   // a transient error is NOT baked as a permanent 'off'
  });

  it("an authorizing-PERSON read error (auto lane) → subscriber_retry, never a false refused_authority", async () => {
    const cfg: MockConfig = {
      acts: { a1: [{ id: "act1", position: 1, action_kind: "n8n_run_workflow", tool_key: null, config: {} }] },
      activeMembers: new Set(["t1:owner1"]), lanes: { a1: { effective: "auto" } }, recorded: [],
      fromErrors: new Set(["tenant_members"]),   // acts load fine; the person read errors
    };
    const res = await runEventActs(mockDb(cfg), event, [auto({})]);
    expect(res.subscriber_retry).toEqual(["a1"]);
    expect(res.records).toHaveLength(0);
    expect(res.by_outcome.refused_authority ?? 0).toBe(0);  // a transient error is NOT baked as a refusal
  });
});
