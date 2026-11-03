import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ actor: "e5020000-0000-4000-8000-000000000001", tenant: "e5020000-0000-4000-8000-000000000002", request: "", calls: [] as string[], lost: false, nativeCount: 0, row: null as unknown, mode: "ok" }));
vi.mock("@/lib/scopedUser", () => ({ getScopedUserId: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ error: null, data: { session: { user: { id: f.actor } } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    f.calls.push(name);
    if (name === "current_user_tenant_id") return { error: null, data: f.tenant };
    if (name === "is_tenant_admin") return { error: null, data: true };
    f.request = String(args.p_request_id);
    if (f.mode === "refused") return { error: { code: "40001" }, data: null };
    if (f.mode === "unknown") return { error: null, data: { status: "unknown" } };
    if (f.mode === "absent") return { error: null, data: { status: "not_found" } };
    if (name === "save_weekly_plan_review_scoped") { f.nativeCount++; if (f.lost) throw new TypeError("committed; acknowledgement lost"); }
    return { error: null, data: { confirmed_goal: "Confirmed goal", starts_on: "2026-11-02", confirmed_capacity_minutes: { [f.actor]: 120 }, status: "succeeded", request_id: f.request, plan_id: "e5020000-0000-4000-8000-000000000003", receipt_run_id: "e5020000-0000-4000-8000-000000000004", work_id: "e5020000-0000-4000-8000-000000000005", review_zone: "UTC", current_work: [{key:"crm:e5020000-0000-4000-8000-000000000006",state:"unavailable"}] } };
  },
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: null, data: f.row ?? { id: "e5020000-0000-4000-8000-000000000003", tenant_id: f.tenant, created_by: f.actor,
    metadata: { weekly_plan_review_v1: { request_id: f.request, receipt_run_id: "e5020000-0000-4000-8000-000000000004" } } } }) }; return q; },
} }));
import { retainedWeeklyPlanAttempt, saveWeeklyPlanReview, weeklyPlanSaveRequest } from "./operations-weekly-plan-save";
const scope = () => ({ actorId: f.actor, tenantId: f.tenant });
const request = { v: 1 as const, starts_on: "2026-11-02", zone: "America/New_York", goal: "Confirmed goal", sources: [], included: [], capacity_minutes: {} };
beforeEach(() => { sessionStorage.clear(); f.calls = []; f.lost = false; f.nativeCount = 0; f.row = null; f.mode = "ok"; });
it("retains identity before the only native save and requires exact caller/Rail readback", async () => {
  const result = await saveWeeklyPlanReview(scope(), request, () => true);
  expect(result.kind).toBe("verified"); expect(retainedWeeklyPlanAttempt(scope())).toBe(f.request);
  expect(f.nativeCount).toBe(1); expect(f.calls.filter(x => x === "save_weekly_plan_review_scoped")).toHaveLength(1);
});
it("lost acknowledgement reload checks the original attempt without another creation", async () => {
  f.lost = true; expect((await saveWeeklyPlanReview(scope(), request, () => true)).kind).toBe("uncertain");
  const original = retainedWeeklyPlanAttempt(scope()); f.lost = false;
  const recovered=await saveWeeklyPlanReview(scope(), null, () => true);expect(recovered.kind).toBe("verified");expect(recovered.kind==="verified"&&recovered.recovered).toBe(true);
  expect(f.request).toBe(original); expect(f.nativeCount).toBe(1);
  expect(f.calls).toContain("get_weekly_plan_review_result_scoped");
});
it("unknown, refused or mismatched original readback never become success", async () => {
  f.mode = "unknown"; expect((await saveWeeklyPlanReview(scope(), request, () => true)).kind).toBe("uncertain");
  f.mode = "refused"; expect((await saveWeeklyPlanReview(scope(), request, () => true)).kind).toBe("refused");
  f.mode = "ok"; f.row = { id: "foreign-plan", tenant_id: "foreign" };
  expect((await saveWeeklyPlanReview(scope(), null, () => true)).kind).toBe("uncertain");
});
it("a changed actor/tenant or unreadable recovery pointer starts no native operation", async () => {
  expect((await saveWeeklyPlanReview(scope(), request, () => false)).kind).toBe("refused");
  expect(f.calls).toEqual([]);
  sessionStorage.setItem(`paige:operations-weekly-plan:${f.actor}:${f.tenant}`, "invalid-pointer");
  expect((await saveWeeklyPlanReview(scope(), request, () => true)).kind).toBe("uncertain"); expect(f.nativeCount).toBe(0);
});
it("read-only absence does not manufacture a completed or new Plan", async () => {
  expect(await saveWeeklyPlanReview(scope(), null, () => true)).toEqual({ kind: "absent" }); expect(f.nativeCount).toBe(0);
});
it("stores original references, versions and owner inputs, never model/DM text or copied records", () => {
  const work = { key: "crm:original", tenantId: f.tenant, ownerId: f.actor, title: "Private source title", status: "open" as const, priority: "normal" as const, dueAt: null, updatedAt: "2026-11-03T12:00:00Z", minutes: 60 };
  const result = weeklyPlanSaveRequest({ tenantId: f.tenant, startsOn: "2026-11-02", zone: "UTC", goal: "  Confirmed goal ", work: [work], selected: [work.key], estimates: {}, capacities: {}, dependencies: {}, priorityOrder: [] }, [work.key]);
  expect(result.sources).toEqual([{ key: work.key, updated_at: work.updatedAt, minutes: 60, dependencies: [] }]);
  expect(JSON.stringify(result)).not.toContain(work.title); expect(result.goal).toBe("Confirmed goal");
});
