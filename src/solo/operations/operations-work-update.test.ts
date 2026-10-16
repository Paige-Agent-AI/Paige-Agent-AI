import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, auth: { getSession: mock.getSession } } }));
import { submitOperationsWorkUpdate } from "./operations-work-update";
import type { WorkUpdate } from "./operations-work-update";
const scope = { actorId: "actor-a", tenantId: "tenant-a", itemId: "item-a", expectedUpdatedAt: "2026-10-10T12:00:00.123456Z" };
beforeEach(() => { vi.resetAllMocks(); mock.getSession.mockResolvedValue({ data: { session: { user: { id: scope.actorId } } }, error: null }); });
it("does not submit an edit after the authenticated account changes", async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: "actor-b" } } }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("refused");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("binds actor, workspace and item and acknowledges only a matching server result", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: scope.itemId }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "blocked" })).kind).toBe("acknowledged");
  expect(mock.rpc).toHaveBeenCalledWith("plan_update_item_versioned", { p_expected_actor_id: "actor-a", p_expected_tenant_id: "tenant-a", p_item_id: "item-a", p_expected_updated_at: scope.expectedUpdatedAt, p_status: "blocked" });
});
it("refuses stale versions without automatically resubmitting", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
  const result = await submitOperationsWorkUpdate(scope, { status: "done" });
  expect(result.kind).toBe("refused");
  expect("message" in result && result.message).toContain("Someone changed");
  expect(mock.rpc).toHaveBeenCalledOnce();
});
it("does not write when the current record version is missing", async () => {
  expect((await submitOperationsWorkUpdate({ ...scope, expectedUpdatedAt: undefined }, { status: "done" })).kind).toBe("refused");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("keeps a lost response or mismatched acknowledgement uncertain without retrying", async () => {
  mock.rpc.mockRejectedValue(new Error("lost response"));
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: "actor-b", tenant_id: "tenant-a", item_id: "item-a" }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("uncertain");
});
it("distinguishes an authoritative refusal from an unconfirmed network result", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("refused");
  mock.rpc.mockResolvedValue({ data: null, error: { code: "504" } });
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("uncertain");
});
it("delegates priority edits with the original source version and scope", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: scope.itemId }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { priority: "high", status: "blocked" })).kind).toBe("acknowledged");
  expect(mock.rpc).toHaveBeenCalledWith("plan_update_item_priority_versioned", expect.objectContaining({
    p_priority: "high", p_status: "blocked", p_expected_updated_at: scope.expectedUpdatedAt,
    p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
  }));
});
it("routes explicit cancellation to the versioned native removal contract", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, status: "cancelled", actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: scope.itemId }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "cancelled" })).kind).toBe("acknowledged");
  expect(mock.rpc).toHaveBeenCalledWith("plan_remove_item_versioned", { p_item_id: scope.itemId,
    p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId, p_expected_updated_at: scope.expectedUpdatedAt });
});
it("reschedules only through the distinct native versioned contract with an exact matching acknowledgement",async()=>{
  const remindAt="2099-02-01T13:30:00+03:00";
  mock.rpc.mockResolvedValue({data:{ok:true,actor_id:scope.actorId,tenant_id:scope.tenantId,item_id:scope.itemId,remind_at:"2099-02-01T10:30:00Z",railRecorded:true,receipt_status:"recorded",receipt_run_id:"native-audit"},error:null});
  expect((await submitOperationsWorkUpdate(scope,{remindAt})).kind).toBe("acknowledged");
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("plan_reschedule_reminder_versioned",{p_item_id:scope.itemId,p_expected_actor_id:scope.actorId,p_expected_tenant_id:scope.tenantId,p_expected_updated_at:scope.expectedUpdatedAt,p_remind_at:remindAt});
  mock.rpc.mockResolvedValue({data:{ok:true,actor_id:scope.actorId,tenant_id:scope.tenantId,item_id:scope.itemId,remind_at:"2099-01-01T13:00:00Z"},error:null});
  expect((await submitOperationsWorkUpdate(scope,{remindAt})).kind).toBe("uncertain");
});
it.each([null,undefined,"","invalid","Infinity","-Infinity","2000-01-01T00:00:00Z"])("refuses invalid/nonfuture reminder time before dispatch (%s)",async remindAt=>{
  expect((await submitOperationsWorkUpdate(scope,{remindAt} as WorkUpdate)).kind).toBe("refused");expect(mock.rpc).not.toHaveBeenCalled();
});
it.each([{dueAt:"2099-01-01"},{status:"done"},{priority:"high"},{assigneeId:"other"}])("refuses mixed reschedule terms without discarding any term (%o)",async extra=>{
  expect((await submitOperationsWorkUpdate(scope,{remindAt:"2099-02-01T13:00:00Z",...extra} as WorkUpdate)).kind).toBe("refused");expect(mock.rpc).not.toHaveBeenCalled();
});
it("holds a lost reschedule acknowledgement without another route or retry",async()=>{
  mock.rpc.mockRejectedValue(new Error("Lost native acknowledgement"));
  expect((await submitOperationsWorkUpdate(scope,{remindAt:"2099-02-01T13:00:00Z"})).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledTimes(1);expect(mock.rpc.mock.calls[0][0]).toBe("plan_reschedule_reminder_versioned");
});
it("never discards other requested terms into a cancellation or retries an unconfirmed removal", async () => {
  expect((await submitOperationsWorkUpdate(scope, { status: "cancelled", priority: "high" })).kind).toBe("refused");
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockRejectedValue(new Error("Lost native acknowledgement"));
  expect((await submitOperationsWorkUpdate(scope, { status: "cancelled" })).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledOnce();
  mock.rpc.mockResolvedValue({ data: { ok: true, status: "open", actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: scope.itemId }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "cancelled" })).kind).toBe("uncertain");
  expect(mock.rpc).toHaveBeenCalledTimes(2);
});
