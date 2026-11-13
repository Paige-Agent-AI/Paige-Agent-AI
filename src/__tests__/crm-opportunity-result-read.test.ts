import { describe, expect, it } from "vitest";
import { inspectOpportunityResult } from "../../supabase/functions/_shared/crm-command/opportunity-result-read";

const TENANT = "e4000000-0000-4000-8000-0000000a0001";
const ACTOR = "e4000000-0000-4000-8000-0000000a0002";
const DEAL = "e4000000-0000-4000-8000-0000000a0003";
const CORRELATION = "e4000000-0000-4000-8000-0000000a0004";
const FOREIGN = "e4000000-0000-4000-8000-0000000a0005";
type Row = Record<string, unknown>;
function world() {
  const state = { active: TENANT, role: "owner", status: "active", account_type: "standalone", parent_tenant_id: null as string | null,
    account_number: 201, visible: true, version: 4, receiptActor: ACTOR, receiptTenant: TENANT,
    stored: { action: "deal.update", created_at: "2026-10-10T12:00:00Z", result: {
      ok: true, action: "deal.update", outcome: "succeeded", receipt_recorded: true, correlation_id: CORRELATION,
      readback: { id: DEAL, version: 3, title: "Private title", notes: "Private notes", value_cents: 100 },
    } } as Row | null,
    fail: "", afterResult: () => {}, calls: [] as string[], resultReads: 0 };
  const from = (caller: boolean) => (table: string) => {
    const filters: Record<string, unknown> = {};
    const read = () => {
      state.calls.push(`${caller ? "caller" : "admin"}:${table}`);
      if (state.fail === table) return { data: null, error: { message: "Private transport detail" } };
      let data: unknown = null;
      if (table === "user_roles") data = [];
      else if (table === "tenant_members") {
        if (filters.tenant_id === TENANT && filters.user_id === ACTOR) data = { role: state.role, status: "active" };
      } else if (table === "tenants") {
        if (filters.id === TENANT) data = { id: TENANT, status: state.status, account_type: state.account_type,
          parent_tenant_id: state.parent_tenant_id, account_number: state.account_number };
      } else if (table === "deals") {
        if (!caller) throw Error("Original caller RLS must read the deal");
        if (state.visible && filters.tenant_id === TENANT && filters.id === DEAL) data = { id: DEAL, version: state.version };
      } else if (table === "crm_command_results") {
        if (caller) throw Error("Original private result requires the authorized service reader");
        state.resultReads++;
        if (filters.tenant_id === state.receiptTenant && filters.actor_user_id === state.receiptActor
          && filters.action === "deal.update" && filters["result->>correlation_id"] === CORRELATION) data = state.stored;
        state.afterResult();
      } else throw Error(`Unexpected table: ${table}`);
      return { data, error: null };
    };
    const q = { select: (_columns: string) => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      maybeSingle: async () => read(),
      then: (resolve: (value: ReturnType<typeof read>) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(read()).then(resolve, reject) };
    return q;
  };
  const caller = { from: from(true), rpc: async (name: string) => {
    if (name !== "current_user_tenant_id") throw Error(`Forbidden caller RPC ${name}`);
    return { data: state.active, error: state.fail === "active" ? {} : null };
  } };
  const admin = { from: from(false), rpc: async (name: string) => {
    if (name === "is_tenant_admin_as") return { data: ["owner", "admin"].includes(state.role), error: null };
    if (name === "agency_can_manage_child") return { data: false, error: null };
    throw Error(`No execution/approval RPC is permitted: ${name}`);
  } };
  const raw = { expected_tenant_id: TENANT, inspect_opportunity_result: { deal_id: DEAL, correlation_id: CORRELATION } };
  return { state, raw, run: (request: unknown = raw, actorId = ACTOR) => inspectOpportunityResult({ raw: request, actorId, caller, admin }) };
}

describe("same original Opportunity result inspection", () => {
  it.each(["owner", "admin"])("reads the exact existing receipt as a current %s without executing", async role => {
    const w = world(); w.state.role = role;
    const answer = await w.run();
    expect(answer).toEqual({ status: 200, body: { ok: true, outcome: "recorded", receipt: {
      action: "deal.update", correlation_id: CORRELATION, record_id: DEAL, recorded_at: "2026-10-10T12:00:00Z", result_version: 3,
    }, current_version: 4 } });
    expect(JSON.stringify(answer)).not.toMatch(/Private|notes|value_cents|idempotency|command_hash|actor_user_id/);
    expect(w.state.resultReads).toBe(1);
  });
  it.each(["member", "coach", "viewer", "super_admin", ""])("refuses %s before reading private results", async role => {
    const w = world(); w.state.role = role;
    expect((await w.run()).status).toBe(403); expect(w.state.resultReads).toBe(0);
  });
  it("does not inspect another active workspace, actor or inaccessible record", async () => {
    const a = world(); a.state.active = FOREIGN;
    expect((await a.run()).status).toBe(403); expect(a.state.resultReads).toBe(0);
    const b = world(); expect((await b.run(b.raw, FOREIGN)).status).toBe(403); expect(b.state.resultReads).toBe(0);
    const c = world(); c.state.visible = false;
    expect((await c.run()).status).toBe(404); expect(c.state.resultReads).toBe(0);
  });
  it.each(["receiptActor", "receiptTenant"] as const)("does not find another %s's receipt", async key => {
    const w = world(); w.state[key] = FOREIGN;
    expect((await w.run()).status).toBe(404);
  });
  it.each(["suspended", "canceled", "unknown"])("does not disclose a receipt in a %s workspace", async status => {
    const w = world(); w.state.status = status;
    expect((await w.run()).status).toBe(403); expect(w.state.resultReads).toBe(0);
  });
  it.each([{ account_type: "agency" }, { parent_tenant_id: FOREIGN }, { account_number: 0 }])("requires canonical SOLO classification (%j)", async patch => {
    const w = world(); Object.assign(w.state, patch);
    expect((await w.run()).status).toBe(403); expect(w.state.resultReads).toBe(0);
  });
  it.each(["role", "active", "status", "visible"])("revalidates %s after reading the original receipt", async field => {
    const w = world();
    w.state.afterResult = () => {
      if (field === "role") w.state.role = "member";
      else if (field === "active") w.state.active = FOREIGN;
      else if (field === "status") w.state.status = "suspended";
      else w.state.visible = false;
    };
    expect((await w.run()).status).not.toBe(200);
  });
  it.each(["active", "tenant_members", "tenants", "deals", "crm_command_results"])("fails closed on %s read errors without leaking errors", async table => {
    const w = world(); w.state.fail = table;
    const answer = await w.run(); expect(answer.status).not.toBe(200);
    expect(JSON.stringify(answer)).not.toContain("Private transport detail");
  });
  it("never converts a missing result into an update or approval", async () => {
    const w = world(); w.state.stored = null;
    expect((await w.run()).status).toBe(404);
    expect((await w.run()).status).toBe(404); expect(w.state.resultReads).toBe(2);
  });
  it.each([{ outcome: "unknown" }, { ok: false }, { receipt_recorded: false }, { correlation_id: FOREIGN },
    { action: "deal.create" }, { readback: { id: FOREIGN, version: 3 } }, { readback: { id: DEAL, version: 0 } },
    { readback: { id: DEAL, version: 5 } }, { readback: { id: DEAL, version: 3, absent: true } }])("refuses inconsistent original result (%j)", async patch => {
    const w = world(); Object.assign(w.state.stored!.result as Row, patch);
    expect((await w.run()).status).toBe(503);
  });
  it.each([{ actor_id: ACTOR }, { command: { action: "deal.update" } }, { approved_fingerprint: "injected" },
    { idempotency_key: "injected" }, { inspect_mission_task: {} }])("rejects extra request authority or effects (%j)", async extra => {
    const w = world(); expect((await w.run({ ...w.raw, ...extra })).status).toBe(400); expect(w.state.calls).toEqual([]);
  });
  it("rejects malformed and excess inner locators before any reads", async () => {
    const w = world();
    for (const inner of [null, { ...w.raw.inspect_opportunity_result, correlation_id: `${CORRELATION}\n` },
      { ...w.raw.inspect_opportunity_result, deal_id: "bad" }, { ...w.raw.inspect_opportunity_result, tenant_id: TENANT }]) {
      expect((await w.run({ ...w.raw, inspect_opportunity_result: inner })).status).toBe(400);
    }
    expect(w.state.calls).toEqual([]);
  });
});
