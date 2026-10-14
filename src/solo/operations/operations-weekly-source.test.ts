import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setScopedUserId } from "@/lib/scopedUser";
import type { PlanItem } from "@/hooks/usePlanList";

const mock = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), or: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mock.session }, rpc: mock.rpc, from: mock.from } }));
import { parseWeeklyPlanningSource, readWeeklyPlanningSource } from "./operations-weekly-source";

const actorId = "10000000-0000-4000-8000-000000000001";
const tenantId = "20000000-0000-4000-8000-000000000001";
const itemId = "30000000-0000-4000-8000-000000000001";
const scope = { actorId, tenantId, itemId };
const item: PlanItem = { id: itemId, tenant_id: tenantId, plan_id: null, item_type: "task", assigned_to_user_id: actorId,
  contact_id: null, title: "Review source work", summary: null, status: "open", priority: "normal", due_at: null,
  remind_at: null, remind_target: null, reminded_at: null, created_by: actorId, linked_action_id: null,
  updated_at: "2026-10-10T12:00:00.123456Z" };
beforeEach(() => {
  setScopedUserId(null);
  vi.resetAllMocks(); mock.session.mockResolvedValue({ data: { session: { user: { id: actorId } } }, error: null });
  mock.rpc.mockImplementation(async name => ({ data: name === "is_tenant_member" ? true : tenantId, error: null }));
  const query = { select: mock.select, eq: mock.eq, or: mock.or, maybeSingle: mock.read };
  mock.from.mockReturnValue(query); mock.select.mockReturnValue(query); mock.eq.mockReturnValue(query); mock.or.mockReturnValue(query);
  mock.read.mockResolvedValue({ data: item, error: null });
});
afterEach(() => setScopedUserId(null));
it("refuses an effective client persona before calls and discards a point read when it changes", async () => {
  setScopedUserId("client");
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
  expect(mock.session).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled();
  setScopedUserId(null);
  mock.read.mockImplementation(async () => { setScopedUserId("client"); return { data: item, error: null }; });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
});
it("accepts only one explicitly typed Planning UUID target", () => {
  expect(parseWeeklyPlanningSource(`?weeklySource=planning_item&item=${itemId}`)).toEqual({ kind: "planning_item", id: itemId });
  expect(parseWeeklyPlanningSource("?other=value")).toBeNull();
  for (const query of [`?weeklySource=crm&item=${itemId}`, "?weeklySource=planning_item&item=not-a-uuid",
    `?weeklySource=planning_item&weeklySource=planning_item&item=${itemId}`, `?weeklySource=planning_item&item=${itemId}&item=${itemId}`,
    `?item=${itemId}`, "?weeklySource=planning_item"]) expect(parseWeeklyPlanningSource(query)).toEqual({ kind: "invalid" });
});
it("reads the exact personal Planning row and preserves the raw canonical version", async () => {
  const result = await readWeeklyPlanningSource(scope, () => true);
  expect(result).toEqual({ kind: "verified", item });
  expect(mock.from).toHaveBeenCalledWith("plan_items");
  expect(mock.eq).toHaveBeenCalledWith("tenant_id", tenantId); expect(mock.eq).toHaveBeenCalledWith("id", itemId);
  expect(mock.or).toHaveBeenCalledWith(`created_by.eq.${actorId},assigned_to_user_id.eq.${actorId}`);
  expect(mock.rpc.mock.calls).toEqual([["current_user_tenant_id"], ["is_tenant_member", { _tenant: tenantId }], ["current_user_tenant_id"], ["is_tenant_member", { _tenant: tenantId }]]);
  expect(result.kind === "verified" && result.item.updated_at).toBe("2026-10-10T12:00:00.123456Z");
});
it("makes no row read for a malformed scope, changed actor or changed canonical tenant", async () => {
  expect((await readWeeklyPlanningSource({ ...scope, itemId: "bad" }, () => true)).kind).toBe("unavailable");
  mock.session.mockResolvedValue({ data: { session: { user: { id: "other" } } }, error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
  mock.session.mockResolvedValue({ data: { session: { user: { id: actorId } } }, error: null });
  mock.rpc.mockResolvedValue({ data: "other-tenant", error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable"); expect(mock.from).not.toHaveBeenCalled();
});
it("refuses missing, revoked, foreign, unrelated or malformed returned rows", async () => {
  for (const row of [null, { ...item, id: "40000000-0000-4000-8000-000000000001" }, { ...item, tenant_id: "other" },
    { ...item, created_by: "other", assigned_to_user_id: "other" }, { ...item, status: "fabricated" }, { ...item, title: null }]) {
    mock.read.mockResolvedValue({ data: row, error: null }); expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
  }
  mock.read.mockResolvedValue({ data: item, error: { code: "42501" } });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
});
it("drops late selection, actor and tenant changes after the row has returned", async () => {
  let current = true;
  mock.read.mockImplementation(async () => { current = false; return { data: item, error: null }; });
  expect((await readWeeklyPlanningSource(scope, () => current)).kind).toBe("unavailable");
  mock.read.mockResolvedValue({ data: item, error: null });
  mock.session.mockResolvedValueOnce({ data: { session: { user: { id: actorId } } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "other" } } }, error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
  mock.session.mockResolvedValue({ data: { session: { user: { id: actorId } } }, error: null });
  mock.rpc.mockResolvedValueOnce({ data: tenantId, error: null }).mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: "other", error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable");
});
it("returns cancelled native records for read-only inspection and never writes", async () => {
  mock.read.mockResolvedValue({ data: { ...item, status: "cancelled" }, error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("verified");
  expect(mock.select).toHaveBeenCalledOnce(); expect(mock.rpc.mock.calls.every(([name]) => ["current_user_tenant_id", "is_tenant_member"].includes(name))).toBe(true);
});
it("requires current target membership before and after reading an old personal assignment", async () => {
  mock.rpc.mockImplementation(async name => ({ data: name === "is_tenant_member" ? false : tenantId, error: null }));
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable"); expect(mock.from).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({ data: tenantId, error: null }).mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: tenantId, error: null }).mockResolvedValueOnce({ data: false, error: null });
  expect((await readWeeklyPlanningSource(scope, () => true)).kind).toBe("unavailable"); expect(mock.from).toHaveBeenCalledOnce();
});
