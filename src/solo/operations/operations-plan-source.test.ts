import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ current: true, actor: "e5020000-0000-4000-8000-000000000001", tenant: "e5020000-0000-4000-8000-000000000002", plan: "e5020000-0000-4000-8000-000000000003", foreign: false, member: true, late: false, reads: [] as string[] }));
vi.mock("@/lib/scopedUser", () => ({ getScopedUserId: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ error: null, data: { session: { user: { id: f.actor } } } }) },
  rpc: async (name: string) => ({ error: null, data: name === "is_tenant_member" ? f.member : f.tenant }),
  from: (table: string) => { f.reads.push(table); const q = { select: () => q, eq: () => q, order: () => q,
    maybeSingle: async () => ({ error: null, data: { id: f.plan, tenant_id: f.foreign ? "foreign" : f.tenant, title: "Original saved Plan" } }),
    limit: async () => { if (f.late) f.current = false; return { error: null, data: Array.from({length:201}, (_, n) => ({ id: String(n), tenant_id: f.tenant, plan_id: f.plan })) }; } }; return q; },
} }));
import { parseOperationsPlanFocus, readOperationsPlanSource } from "./operations-plan-source";
beforeEach(() => { f.current = true; f.member = true; f.foreign = false; f.late = false; f.reads = []; });
afterEach(() => vi.useRealTimers());
const read = () => readOperationsPlanSource({ actorId: f.actor, tenantId: f.tenant, planId: f.plan }, () => f.current);
it("accepts exactly one typed original Plan locator and refuses ambiguous Work/draft locators", () => {
  expect(parseOperationsPlanFocus(`?planningPlan=${f.plan}`)).toEqual({kind:"plan",id:f.plan});
  for (const tail of [`&planningPlan=${f.plan}`, "&task=other", "&planningItem=other", "&weeklyPlan=review"]) expect(parseOperationsPlanFocus(`?planningPlan=${f.plan}${tail}`)).toEqual({kind:"invalid"});
  expect(parseOperationsPlanFocus("?planningPlan=other")).toEqual({kind:"invalid"}); expect(parseOperationsPlanFocus("?task=other")).toBeNull();
});
it("opens the exact caller-RLS Plan beyond bounded lists and exposes the visible item cap truthfully", async () => {
  const result = await read(); expect(result?.id).toBe(f.plan); expect(result?.items).toHaveLength(200); expect(result?.itemsPartial).toBe(true);
  expect(f.reads).toEqual(["plans", "plan_items"]);
});
it("refuses foreign, revoked or retired reads without a fallback identity or source", async () => {
  f.foreign = true; expect(await read()).toBeNull(); expect(f.reads).toEqual(["plans"]);
  f.foreign = false; f.reads = []; f.member = false; expect(await read()).toBeNull(); expect(f.reads).toEqual([]);
  f.member = true; f.late = true; expect(await read()).toBeNull();
});
