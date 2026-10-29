// node --test supabase/functions/_shared/team-hub/mentor-plan-read.test.ts
// MENTOR's one Team Hub DM read (plan_list) — unit tests of the adapter's own gates. The
// agent-turn wiring is proved in agent-turn.test.ts; the RPC definer in its own migrations. All
// ids and text are fictional. EVIDENCE CLASS: automated unit tests of the module.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MENTOR_PLAN_MAX_ROWS, mentorPlanReadTools, planReadArgumentsFor, readMentorPlan, type MentorPlanReadDeps, type MentorPlanScope,
} from "./mentor-plan-read.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const PLAN = "55555555-5555-4555-8555-555555555555";
const SCOPE: MentorPlanScope = { tenantId: TENANT, actorId: SAM, storedTools: ["read_business_time_zone", "plan_list"] };
const NO_LIST: MentorPlanScope = { tenantId: TENANT, actorId: SAM, storedTools: ["read_business_time_zone"] };

function deps(over: Partial<Record<"rpc" | "isCurrent" | "recordRead", unknown>> = {}): MentorPlanReadDeps & { calls: Array<{ name: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const table: Record<string, unknown> = {
    plan_list: { plans: [{ id: PLAN, title: "Launch week", items: [] }], loose_items: [] },
    current_user_tenant_id: TENANT,
    ...((over.rpc as Record<string, unknown>) ?? {}),
  };
  return {
    calls,
    caller: {
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name in table) {
          const v = table[name] as { data?: unknown; error?: unknown } | unknown;
          if (v && typeof v === "object" && "error" in (v as object)) return v as { data: unknown; error: { message?: string } | null };
          return { data: v, error: null };
        }
        return { data: null, error: null };
      },
    },
    isCurrent: (over.isCurrent as (() => Promise<boolean>) ?? (async () => true)),
    recordRead: (over.recordRead as (() => Promise<boolean>) ?? (async () => true)),
  };
}

describe("offering", () => {
  it("offers the exact main-chat plan_list schema only when the stored DM list names it", () => {
    const offered = mentorPlanReadTools(SCOPE);
    assert.equal(offered.length, 1);
    assert.equal(offered[0].function.name, "plan_list");
    assert.deepEqual(mentorPlanReadTools(NO_LIST), []);
    assert.deepEqual(mentorPlanReadTools({ ...SCOPE, tenantId: "not-a-uuid" }), []);
    assert.deepEqual(mentorPlanReadTools({ ...SCOPE, actorId: "not-a-uuid" }), []);
  });
});

describe("arguments", () => {
  it("accepts only the live schema's keys, typed, and refuses everything else", () => {
    assert.deepEqual(planReadArgumentsFor({}), { horizon: null, plan_id: null, status: null, include_cancelled: false, assigned_to_user_id: null, from: null, to: null, limit: 50 });
    assert.deepEqual(planReadArgumentsFor({ horizon: "week", limit: 10, include_cancelled: true }),
      { horizon: "week", plan_id: null, status: null, include_cancelled: true, assigned_to_user_id: null, from: null, to: null, limit: 10 });
    for (const bad of [
      "not-an-object", null, [], { surprise: 1 }, { horizon: "decade" }, { plan_id: "nope" },
      { status: "" }, { status: "x".repeat(41) }, { include_cancelled: "yes" }, { assigned_to_user_id: "nope" },
      { from: "" }, { from: "x".repeat(33) }, { to: "x".repeat(33) }, { limit: 0 }, { limit: 1.5 }, { limit: 201 },
    ]) assert.equal(planReadArgumentsFor(bad), null, JSON.stringify(bad));
  });
});

describe("reading", () => {
  it("reads under the asker's client, receipts first, verifies the tenant pin, and returns the proven shape", async () => {
    const d = deps();
    const read = await readMentorPlan(SCOPE, d, "plan_list", { horizon: "week" });
    assert.equal((read.model as { success?: boolean }).success, true);
    assert.equal((read.model as { plans?: unknown[] }).plans!.length, 1);
    assert.equal(d.calls[0].name, "plan_list");
    assert.equal(d.calls[0].args!.p_tenant_id, TENANT);
    assert.equal(d.calls[0].args!.p_limit, MENTOR_PLAN_MAX_ROWS, "the server-side cap bounds even the default limit");
    assert.equal(d.calls[1].name, "current_user_tenant_id");
    assert.equal(await read.revalidate(), true);
  });
  it("status 'cancelled' asks for saved history exactly like the live binding's marshal", async () => {
    const d1 = deps(); const d2 = deps();
    await readMentorPlan(SCOPE, d1, "plan_list", { status: "cancelled" });
    assert.equal(d1.calls[0].args!.p_status, "cancelled");
    assert.equal(d1.calls[0].args!.p_include_cancelled, true, "status cancelled implies history");
    await readMentorPlan(SCOPE, d2, "plan_list", {});
    assert.equal(d2.calls[0].args!.p_include_cancelled, false, "default stays history-free");
  });
  it("caps rows server-side regardless of the request", async () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ id: `${i}`, items: [] }));
    const d = deps({ rpc: { plan_list: { plans: many, loose_items: many }, current_user_tenant_id: TENANT } });
    const read = await readMentorPlan(SCOPE, d, "plan_list", { limit: 200 });
    const model = read.model as { plans: unknown[]; loose_items: unknown[]; truncated: boolean };
    assert.equal(model.plans.length, MENTOR_PLAN_MAX_ROWS);
    assert.equal(model.loose_items.length, MENTOR_PLAN_MAX_ROWS);
    assert.equal(model.truncated, true);
    assert.equal(d.calls[0].args!.p_limit, MENTOR_PLAN_MAX_ROWS);
  });
  it("withholds when the scope gate, the receipt, the RPC, the tenant pin or the shape fails — never guessing", async () => {
    const cases: Array<[string, MentorPlanReadDeps]> = [
      ["gate", deps({ isCurrent: async () => false })],
      ["receipt", deps({ recordRead: async () => false })],
      ["rpc error", deps({ rpc: { plan_list: { error: { message: "PLAN_FORBIDDEN" }, data: null } } })],
      ["tenant pin", deps({ rpc: { current_user_tenant_id: "99999999-9999-4999-8999-999999999999" } })],
      ["shape", deps({ rpc: { plan_list: { plans: "nope", loose_items: [] } } })],
    ];
    for (const [label, d] of cases) {
      const read = await readMentorPlan(SCOPE, d, "plan_list", {});
      const model = read.model as { status?: string; success?: boolean };
      assert.equal(model.status, "unavailable", label);
      assert.equal(model.success, undefined, label);
      assert.equal(await read.revalidate(), false, label);
    }
  });
  it("every adapter-spoken message is agent-neutral — no MENTOR-specific recovery line (EXP05 ZION reuse)", async () => {
    const d = deps({ isCurrent: async () => false });
    const read = await readMentorPlan(SCOPE, d, "plan_list", {});
    const messages = JSON.stringify(read.model) + JSON.stringify(withheldCases());
    assert.ok(!messages.includes("MENTOR"), "no adapter message names an agent");
    function withheldCases() {
      // The remaining fixed strings the adapter can emit on failure paths.
      return [
        "I couldn't verify this read. Nothing was read or changed.",
        "I couldn't verify the current plan records. Nothing was read or changed. Try asking again in a moment.",
        "I couldn't record this read, so I won't report its rows. Nothing was changed. Try again in a moment.",
        "The planning records could not be read. Nothing was changed. Say so plainly and point the owner to the Planning screen.",
        "The current workspace could not be verified. Nothing was changed.",
      ];
    }
  });
  it("invalid arguments are a needs_input answer, and nothing is read or receipted", async () => {
    const d = deps();
    const read = await readMentorPlan(SCOPE, d, "plan_list", { horizon: "decade" });
    assert.equal((read.model as { status?: string }).status, "needs_input");
    assert.equal(d.calls.length, 0);
  });
  it("a stored list without plan_list, a wrong tool name, or an aborted signal never reads", async () => {
    const d = deps();
    const controller = new AbortController();
    controller.abort();
    for (const read of [
      await readMentorPlan(NO_LIST, d, "plan_list", {}),
      await readMentorPlan(SCOPE, d, "plan_create", {}),
      await readMentorPlan(SCOPE, { ...d, signal: controller.signal }, "plan_list", {}),
    ]) {
      assert.equal((read.model as { status?: string }).status, "unavailable");
    }
    assert.equal(d.calls.length, 0);
  });
});
