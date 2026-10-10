import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, auth: { getSession: mock.getSession } } }));
import { submitOperationsWorkUpdate } from "./operations-work-update";
const scope = { actorId: "actor-a", tenantId: "tenant-a", itemId: "item-a" };
beforeEach(() => { vi.resetAllMocks(); mock.getSession.mockResolvedValue({ data: { session: { user: { id: scope.actorId } } }, error: null }); });
it("does not submit an edit after the authenticated account changes", async () => {
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: "actor-b" } } }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "done" })).kind).toBe("refused");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("binds actor, workspace and item and acknowledges only a matching server result", async () => {
  mock.rpc.mockResolvedValue({ data: { ok: true, actor_id: scope.actorId, tenant_id: scope.tenantId, item_id: scope.itemId }, error: null });
  expect((await submitOperationsWorkUpdate(scope, { status: "blocked" })).kind).toBe("acknowledged");
  expect(mock.rpc).toHaveBeenCalledWith("plan_update_item_scoped", { p_expected_actor_id: "actor-a", p_expected_tenant_id: "tenant-a", p_item_id: "item-a", p_status: "blocked" });
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
