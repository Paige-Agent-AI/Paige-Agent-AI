import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: mock.from, auth: { getSession: mock.getSession } } }));
import { createOperationsProjectRecord, type ProjectDraft } from "./operations-project-create";
const scope = { actorId: "test-actor-a", tenantId: "test-tenant-a" };
const draft: ProjectDraft = { kind: "project", title: " New delivery ", summary: " Clear outcome ", ownerId: scope.actorId,
  scope: "individual", horizon: "custom", startsOn: "2026-10-20", endsOn: "2026-11-20" };
const row = { id: "test-plan-a", tenant_id: scope.tenantId, created_by: scope.actorId, title: "New delivery", summary: "Clear outcome",
  owner_user_id: scope.actorId, scope: draft.scope, horizon: draft.horizon, starts_on: draft.startsOn, ends_on: draft.endsOn, status: "draft" };
beforeEach(() => {
  vi.resetAllMocks(); mock.getSession.mockResolvedValue({ data: { session: { user: { id: scope.actorId } } }, error: null });
  mock.rpc.mockResolvedValue({ data: { ok: true, plan_id: row.id, actor_id: scope.actorId, tenant_id: scope.tenantId }, error: null });
  mock.from.mockReturnValue({ select: mock.select }); mock.select.mockReturnValue({ eq: mock.eq });
  mock.eq.mockReturnValue({ eq: mock.eq, maybeSingle: mock.read }); mock.read.mockResolvedValue({ data: row, error: null });
});
it("verifies the canonical draft project only after scoped readback", async () => {
  expect(await createOperationsProjectRecord(scope, draft)).toEqual({ kind: "verified", id: row.id });
  expect(mock.rpc.mock.calls[0][0]).toBe("plan_create_scoped"); expect(mock.from).toHaveBeenCalledWith("plans");
  expect(mock.eq).toHaveBeenCalledWith("tenant_id", scope.tenantId);
});
it.each(["tenant_id", "owner_user_id", "scope", "starts_on", "status"])("does not verify a mismatched project %s", async field => {
  mock.read.mockResolvedValue({ data: { ...row, [field]: "unexpected" }, error: null });
  expect(await createOperationsProjectRecord(scope, draft)).toMatchObject({ kind: "uncertain", id: row.id });
});
it("does not create after an actor switch", async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: "test-actor-b" } } }, error: null });
  expect((await createOperationsProjectRecord(scope, draft)).kind).toBe("refused"); expect(mock.rpc).not.toHaveBeenCalled();
});
it("keeps lost responses unknown without replay", async () => {
  mock.rpc.mockRejectedValue(new Error("lost")); expect((await createOperationsProjectRecord(scope, draft)).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledOnce(); expect(mock.from).not.toHaveBeenCalled();
});
it("refuses canonical authority failures", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await createOperationsProjectRecord(scope, draft)).kind).toBe("refused"); expect(mock.read).not.toHaveBeenCalled();
});
it("never reads an acknowledgement from a foreign scope", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, plan_id: row.id, actor_id: scope.actorId, tenant_id: "test-tenant-b" }, error: null });
  expect((await createOperationsProjectRecord(scope, draft)).kind).toBe("uncertain"); expect(mock.from).not.toHaveBeenCalled();
});
it("does not verify a late result after the session changes", async () => {
  mock.getSession.mockResolvedValueOnce({ data: { session: { user: { id: scope.actorId } } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "test-actor-b" } } }, error: null });
  expect((await createOperationsProjectRecord(scope, draft)).kind).toBe("uncertain");
});
it("verifies a milestone against its parent, person, status and deadline", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, item_id: "test-item-a", actor_id: scope.actorId, tenant_id: scope.tenantId }, error: null });
  mock.read.mockResolvedValue({ data: { id: "test-item-a", tenant_id: scope.tenantId, created_by: scope.actorId, title: "Review", summary: null,
    assigned_to_user_id: scope.actorId, plan_id: row.id, item_type: "milestone", priority: "high", due_at: "2026-11-20T12:00:00+00:00", status: "open" }, error: null });
  expect(await createOperationsProjectRecord(scope, { kind: "milestone", title: "Review", ownerId: scope.actorId,
    planId: row.id, priority: "high", dueAt: "2026-11-20T12:00:00Z" })).toEqual({ kind: "verified", id: "test-item-a" });
  expect(mock.rpc.mock.calls[0][0]).toBe("plan_add_milestone_scoped"); expect(mock.from).toHaveBeenCalledWith("plan_items");
});
