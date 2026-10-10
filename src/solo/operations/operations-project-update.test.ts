import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, auth: { getSession: mock.session } } }));
import { submitOperationsProjectUpdate } from "./operations-project-update";
const scope = { actorId: "actor", tenantId: "tenant", planId: "project", expectedUpdatedAt: "2026-10-10T12:00:00.123456Z" };
const update = { status: "active", ownerId: "actor", startsOn: "2026-10-10", endsOn: "2026-11-10" };
beforeEach(() => { vi.resetAllMocks(); mock.session.mockResolvedValue({ data: { session: { user: { id: "actor" } } }, error: null }); mock.rpc.mockResolvedValue({ data: { ok: true, plan_id: "project", actor_id: "actor", tenant_id: "tenant" }, error: null }); });
it("retains the raw project version and scope in the canonical lifecycle request", async () => {
  expect(await submitOperationsProjectUpdate(scope, update)).toEqual({ kind: "acknowledged" });
  expect(mock.rpc).toHaveBeenCalledWith("plan_update_project_scoped", expect.objectContaining({ p_expected_updated_at: scope.expectedUpdatedAt, p_expected_actor_id: "actor", p_expected_tenant_id: "tenant", p_plan_id: "project", p_status: "active" }));
});
it("refuses missing version without sending a mutation", async () => { expect((await submitOperationsProjectUpdate({ ...scope, expectedUpdatedAt: undefined }, update)).kind).toBe("refused"); expect(mock.rpc).not.toHaveBeenCalled(); });
it("refuses changed actor before mutation", async () => { mock.session.mockResolvedValue({ data: { session: { user: { id: "other" } } }, error: null }); expect((await submitOperationsProjectUpdate(scope, update)).kind).toBe("refused"); expect(mock.rpc).not.toHaveBeenCalled(); });
it("keeps an actor change after mutation uncertain", async () => { mock.session.mockResolvedValueOnce({ data: { session: { user: { id: "actor" } } }, error: null }).mockResolvedValueOnce({ data: { session: { user: { id: "other" } } }, error: null }); expect((await submitOperationsProjectUpdate(scope, update)).kind).toBe("uncertain"); });
it.each(["plan_id", "actor_id", "tenant_id"])("rejects foreign %s acknowledgement", async field => { mock.rpc.mockResolvedValue({ data: { ok: true, plan_id: "project", actor_id: "actor", tenant_id: "tenant", [field]: "foreign" }, error: null }); expect((await submitOperationsProjectUpdate(scope, update)).kind).toBe("uncertain"); });
it("reports unresolved work refusal without claiming completion", async () => { mock.rpc.mockResolvedValue({ data: null, error: { code: "23514" } }); expect(await submitOperationsProjectUpdate(scope, { ...update, status: "completed" })).toEqual({ kind: "refused", message: expect.stringContaining("remaining work") }); });
it("keeps a lost response uncertain without automatic replay", async () => { mock.rpc.mockRejectedValue(new Error("lost")); expect((await submitOperationsProjectUpdate(scope, update)).kind).toBe("uncertain"); expect(mock.rpc).toHaveBeenCalledOnce(); });
it("refuses stale project edits with a refresh instruction", async () => { mock.rpc.mockResolvedValue({ data: null, error: { code: "40001" } }); expect(await submitOperationsProjectUpdate(scope, update)).toEqual({ kind: "refused", message: expect.stringContaining("Someone changed") }); });
