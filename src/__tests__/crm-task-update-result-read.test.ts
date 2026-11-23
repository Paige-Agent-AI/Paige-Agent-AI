import { describe, expect, it } from "vitest";
import { inspectTaskUpdateReceipt } from "../../supabase/functions/_shared/crm-command/task-update-result-read.ts";

const actor = "13000000-0000-4000-8000-000000000001";
const tenant = "13000000-0000-4000-8000-000000000002";
const task = "13000000-0000-4000-8000-000000000003";
const correlation = "13000000-0000-4000-8000-000000000004";
const receipt = "13000000-0000-4000-8000-000000000005";
const other = "13000000-0000-4000-8000-000000000006";
const savedAt = "2026-11-21T16:00:00.123456Z";
const currentAt = "2026-11-21T16:01:00Z";
const ok = <T,>(data: T) => ({ data, error: null });
function callerQuery(data: unknown) {
  const pending = Promise.resolve(ok(data));
  const query = Object.assign(pending, { abortSignal: () => query });
  return query;
}

function setup() {
  const state = {
    active: tenant,
    authActor: actor,
    role: "owner",
    accountStatus: "active",
    accountType: "standalone",
    visible: true,
    currentAt,
    calls: [] as string[],
    stored: {
      actor_user_id: actor, tenant_id: tenant, action: "task.update",
      result: {
        ok: true, action: "task.update", outcome: "succeeded", receipt_recorded: true,
        correlation_id: correlation, readback: { id: task, updated_at: savedAt, description: "private task detail" },
      },
    },
    event: {
      id: receipt, tenant_id: tenant, actor_id: actor, source_kind: "capability_run", source_id: correlation,
      source_revision: 0, capability_key: "crm_update_task", outcome: "capability_succeeded",
      occurred_at: savedAt, detail: { action: "task.update", record_kind: "task", record_id: task, private: "hidden" },
    },
    unavailable: "",
    afterPrivateRead: () => {},
  };
  const caller = {
    auth: { getUser: async () => ok({ user: { id: state.authActor } }) },
    from: () => { throw new Error("Unexpected caller table access"); },
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === "current_user_tenant_id") return callerQuery(state.active);
      if (name !== "operations_crm_work_read") throw new Error("Unexpected caller RPC");
      expect(args).toEqual({ p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_task_id: task });
      const tasks = state.visible ? [{
        id: task, tenant_id: tenant, user_id: actor, title: "Private task", description: null,
        status: "pending", due_date: null, updated_at: state.currentAt, created_at: savedAt,
        deal_id: null, biz_id: null, recorded_priority: null, estimated_minutes: null,
      }] : [];
      return callerQuery({ ok: true, tenant_id: tenant, actor_id: actor, has_more: false, tasks });
    },
  };
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const read = () => {
        state.calls.push(table);
        if (table === state.unavailable) return { data: null, error: { message: "private transport" } };
        switch (table) {
          case "user_roles": return ok([]);
          case "tenants": return ok({
            id: tenant, account_number: 4567, status: state.accountStatus, account_type: state.accountType, parent_tenant_id: null,
          });
          case "tenant_members": return ok({ role: state.role, status: "active" });
          case "crm_command_results":
            expect(filters).toEqual({ tenant_id: tenant, actor_user_id: actor, action: "task.update", "result->>correlation_id": correlation });
            return ok(state.stored);
          case "paige_workspace_events":
            expect(filters).toEqual({
              tenant_id: tenant, actor_id: actor, source_kind: "capability_run", source_id: correlation,
              source_revision: 0, capability_key: "crm_update_task", outcome: "capability_succeeded",
            });
            state.afterPrivateRead();
            return ok(state.event);
          default: throw new Error("Unexpected private table");
        }
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: async () => read(),
        then: (...args: Parameters<Promise<ReturnType<typeof read>>["then"]>) => Promise.resolve(read()).then(...args),
      };
      return query;
    },
    rpc: async (name: string) => {
      if (name === "agency_can_manage_child") return ok(false);
      if (name === "is_tenant_admin_as") return ok(state.role === "owner" || state.role === "admin");
      throw new Error("Unexpected service RPC");
    },
  };
  const raw = { expected_tenant_id: tenant, inspect_task_update_result: { task_id: task, correlation_id: correlation } };
  const run = (request: unknown = raw) => inspectTaskUpdateReceipt({ raw: request, actorId: actor, caller, admin });
  return { raw, state, run };
}

describe("original O03 task update receipt", () => {
  it.each(["owner", "admin"])("returns the same original read-only evidence on reconnect for a current %s", async role => {
    const { state, run } = setup();
    state.role = role;
    const expected = { status: 200, body: { ok: true, outcome: "recorded", receipt: {
      id: receipt, action: "task.update", correlation_id: correlation, record_id: task,
      recorded_at: savedAt, committed_updated_at: savedAt,
    } } };
    expect(await run()).toEqual(expected);
    expect(await run()).toEqual(expected);
    expect(state.calls.filter(table => table === "crm_command_results")).toHaveLength(2);
  });

  it.each([
    ["role", "member"], ["active", other], ["authActor", other], ["accountStatus", "suspended"], ["accountType", "agency"],
  ] as const)("denies %s before the result lookup", async (field, value) => {
    const { state, run } = setup();
    Object.assign(state, { [field]: value });
    expect((await run()).status).toBe(403);
    expect(state.calls).not.toContain("crm_command_results");
  });

  it.each([["role", 403], ["active", 403], ["visible", 404]] as const)("rechecks %s before publishing", async (field, status) => {
    const { state, run } = setup();
    state.afterPrivateRead = () => Object.assign(state, { [field]: field === "role" ? "member" : field === "active" ? other : false });
    expect((await run()).status).toBe(status);
  });

  it.each(["id", "actor_id", "tenant_id", "source_id", "outcome", "capability_key"] as const)("refuses a mismatched Rail %s", async field => {
    const { state, run } = setup();
    state.event[field] = field === "id" ? "invalid" : other;
    expect((await run()).status).toBe(503);
  });

  it("requires native and Rail evidence for the original Task", async () => {
    const a = setup();
    a.state.stored.result.readback.id = other;
    expect((await a.run()).status).toBe(503);
    const b = setup();
    b.state.event.detail.record_id = other;
    expect((await b.run()).status).toBe(503);
  });

  it("keeps initial Task visibility and native success mandatory", async () => {
    const a = setup();
    a.state.visible = false;
    expect((await a.run()).status).toBe(404);
    expect(a.state.calls).not.toContain("paige_workspace_events");
    const b = setup();
    b.state.stored.result.outcome = "unknown";
    b.state.stored.result.receipt_recorded = false;
    expect((await b.run()).status).toBe(503);
  });

  it("reports an unavailable receipt without replaying the action or exposing transport details", async () => {
    const { state, run } = setup();
    state.unavailable = "paige_workspace_events";
    const answer = await run();
    expect(answer.status).toBe(503);
    expect(JSON.stringify(answer)).not.toMatch(/private transport|private task detail/);
  });

  it("refuses extra caller-supplied authority and action parameters", async () => {
    const { raw, state, run } = setup();
    expect((await run({ ...raw, inspect_task_update_result: { ...raw.inspect_task_update_result, actor_id: other } })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
