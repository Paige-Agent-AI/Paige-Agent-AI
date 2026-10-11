import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: mock.from, auth: { getSession: mock.getSession } } }));
import { createOperationsWork } from "./operations-work-create";
const scope = { actorId: "test-actor-a", tenantId: "test-tenant-a" };
const draft = { title: " Review scope ", summary: " Check deliverables ", assigneeId: "test-actor-a", priority: "normal" as const,
  planId: "test-plan-a", milestoneId: "test-milestone-a", dueAt: "2026-10-20T12:00:00Z" };
const row = { id: "test-item-a", tenant_id: scope.tenantId, created_by: scope.actorId, item_type: "task", title: "Review scope",
  summary: "Check deliverables", assigned_to_user_id: draft.assigneeId, priority: draft.priority,
  plan_id: draft.planId, parent_item_id: draft.milestoneId, due_at: "2026-10-20T12:00:00+00:00", contact_id: null, status: "open" };
beforeEach(() => {
  vi.resetAllMocks();
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: scope.actorId } } }, error: null });
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: row.id }, error: null });
  mock.from.mockReturnValue({ select: mock.select }); mock.select.mockReturnValue({ eq: mock.eq });
  mock.eq.mockReturnValue({ eq: mock.eq, maybeSingle: mock.maybeSingle });
  mock.maybeSingle.mockResolvedValue({ data: row, error: null });
});
it("reports creation only after independent scoped field-matching readback", async () => {
  expect(await createOperationsWork(scope, draft)).toEqual({ kind: "verified", itemId: row.id });
  expect(mock.rpc).toHaveBeenCalledOnce();
  expect(mock.rpc.mock.calls[0][0]).toBe("plan_assign_task_scoped");
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({ p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
    p_title: "Review scope", p_plan_id: draft.planId, p_milestone_id: draft.milestoneId });
  expect(mock.eq).toHaveBeenCalledWith("tenant_id", scope.tenantId);
  expect(mock.eq).toHaveBeenCalledWith("id", row.id);
});
it("does not submit after account change", async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: "test-actor-b" } } }, error: null });
  expect((await createOperationsWork(scope, draft)).kind).toBe("refused");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("retains acknowledged identity after refused or unavailable readback, without replaying creation", async () => {
  mock.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await createOperationsWork(scope, draft)).toMatchObject({ kind: "uncertain", itemId: row.id });
  expect(mock.rpc).toHaveBeenCalledOnce();
});
it.each(["tenant_id", "assigned_to_user_id", "parent_item_id", "priority", "status"])("does not verify mismatched %s", async field => {
  mock.maybeSingle.mockResolvedValue({ data: { ...row, [field]: "unexpected" }, error: null });
  expect((await createOperationsWork(scope, draft)).kind).toBe("uncertain");
});
it("rejects late readback after authenticated actor switches", async () => {
  mock.getSession.mockResolvedValueOnce({ data: { session: { user: { id: scope.actorId } } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "test-actor-b" } } }, error: null });
  expect((await createOperationsWork(scope, draft)).kind).toBe("uncertain");
});
it("keeps a lost write response unknown and never automatically retries", async () => {
  mock.rpc.mockRejectedValue(new Error("response interrupted"));
  expect((await createOperationsWork(scope, draft)).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledOnce(); expect(mock.from).not.toHaveBeenCalled();
});
it("does not read an identity from a different scope acknowledgement", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: scope.actorId, tenant_id: "test-tenant-b", item_id: row.id }, error: null });
  expect((await createOperationsWork(scope, draft)).kind).toBe("uncertain");
  expect(mock.from).not.toHaveBeenCalled();
});
