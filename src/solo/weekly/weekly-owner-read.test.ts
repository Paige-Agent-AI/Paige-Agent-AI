import { describe, expect, it, vi } from "vitest";
import { readWeeklyOwner, type WeeklyBrowserScope } from "./weekly-owner-read";

const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let current: WeeklyBrowserScope | null = { actorId: actor, tenantId: tenant, epoch: 1 };
  let sessionActor = actor;
  const raw = { ok: true, scope: "personal_planning_commitments", tenant_id: tenant, actor_id: actor,
    read_at: "2026-10-13T00:00:00Z", limit: 50, has_more: false, business_time_zone: { state: "configured", zone: "UTC" }, checks: [] };
  const caller = { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: sessionActor } } }, error: null })) },
    rpc: vi.fn(async (name: string) => ({ data: name === "current_user_tenant_id" ? tenant : name === "weekly_commitment_owner" ? true : raw, error: null })) };
  return { scope: current!, caller, raw, current: () => current, change: (next: WeeklyBrowserScope | null) => { current = next; }, changeSession: (value: string) => { sessionActor = value; } };
}
describe("browser weekly owner read", () => {
  it("does not start RPCs after a slow session lookup outlives the original inspection", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.caller.auth.getSession.mockImplementationOnce(() => new Promise(resolve => {
        setTimeout(() => resolve({ data: { session: { user: { id: actor } } }, error: null }), 9000);
      }));
      const result = readWeeklyOwner(f.scope, f.caller, f.current);
      await vi.advanceTimersByTimeAsync(8001);
      expect(await result).toEqual({ status: "unavailable" });
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.caller.rpc).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("refuses an active client persona without any authenticated session or RPC call", async () => {
    const f = fixture(); f.scope.actAsClientId = tenant;
    expect((await readWeeklyOwner(f.scope, f.caller, f.current)).status).toBe("refused");
    expect(f.caller.auth.getSession).not.toHaveBeenCalled(); expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it("retires a constructed lazy native query when a queued scope change wins", async () => {
    const f = fixture(), starts: boolean[] = [], constructed: string[] = [];
    const caller = { auth: f.caller.auth, rpc: (name: string) => {
      constructed.push(name);
      queueMicrotask(() => f.change(null));
      return { then: <T = { data: unknown; error: unknown }, U = never>(
        resolve?: ((value: { data: unknown; error: unknown }) => T | PromiseLike<T>) | null,
        reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
      ) => { starts.push(f.current() !== null); return f.caller.rpc(name).then(resolve, reject); } };
    } };
    expect((await readWeeklyOwner(f.scope, caller, f.current)).status).toBe("unavailable");
    expect(constructed).toEqual(["weekly_commitment_owner"]);
    expect(starts).toEqual([]); expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it("retires a constructed lazy session lookup after queued logout", async () => {
    const f = fixture(), starts: boolean[] = [], construct = vi.fn();
    const caller = { rpc: f.caller.rpc, auth: { getSession: () => {
      construct();
      queueMicrotask(() => f.change(null));
      return { then: <T = Awaited<ReturnType<typeof f.caller.auth.getSession>>, U = never>(
        resolve?: ((value: Awaited<ReturnType<typeof f.caller.auth.getSession>>) => T | PromiseLike<T>) | null,
        reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
      ) => { starts.push(f.current() !== null); return f.caller.auth.getSession().then(resolve, reject); } };
    } } };
    expect((await readWeeklyOwner(f.scope, caller, f.current)).status).toBe("unavailable");
    expect(construct).toHaveBeenCalledTimes(1); expect(starts).toEqual([]); expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it("does not consume a lazy session after its factory exhausts the original budget", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), consume = vi.fn(), construct = vi.fn(() => {
        vi.advanceTimersByTime(8001); return { then: consume };
      });
      expect(await readWeeklyOwner(f.scope, { rpc: f.caller.rpc, auth: { getSession: construct } }, f.current)).toEqual({ status: "unavailable" });
      expect(construct).toHaveBeenCalledTimes(1); expect(consume).not.toHaveBeenCalled(); expect(f.caller.rpc).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("reads real canonical status with independent session/tenant/owner readback and no writes", async () => {
    const f = fixture();
    expect((await readWeeklyOwner(f.scope, f.caller, f.current)).status).toBe("ready");
    expect(f.caller.rpc.mock.calls.map(([name]) => name)).toEqual(["weekly_commitment_owner", "current_user_tenant_id", "weekly_commitment_owner", "get_weekly_commitment_checks", "current_user_tenant_id", "weekly_commitment_owner"]);
    expect(f.caller.auth.getSession).toHaveBeenCalledTimes(2);
  });
  it("a role label or route cannot bypass canonical owner refusal", async () => {
    const f = fixture(); f.caller.rpc.mockImplementation(async () => ({ data: false, error: null }));
    expect((await readWeeklyOwner(f.scope, f.caller, f.current)).status).toBe("refused");
    expect(f.caller.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["actor", "tenant", "epoch", "signed_out"])("drops private data on a delayed %s change", async kind => {
    const f = fixture();
    f.caller.rpc.mockImplementation(async name => {
      if (name === "get_weekly_commitment_checks") f.change(kind === "signed_out" ? null : { ...f.scope,
        ...(kind === "actor" ? { actorId: tenant } : kind === "tenant" ? { tenantId: actor } : { epoch: 3 }) });
      return { data: name === "current_user_tenant_id" ? tenant : name === "weekly_commitment_owner" ? true : f.raw, error: null };
    });
    expect((await readWeeklyOwner(f.scope, f.caller, f.current)).status).toBe("refused");
  });
  it("clears a revoked session after a successful read", async () => {
    const f = fixture();
    f.caller.auth.getSession.mockImplementationOnce(async () => ({ data: { session: { user: { id: actor } } }, error: null }))
      .mockImplementationOnce(async () => ({ data: { session: { user: { id: tenant } } }, error: null }));
    expect((await readWeeklyOwner(f.scope, f.caller, f.current)).status).toBe("refused");
  });
  it("a failed read is unavailable, never an empty schedule", async () => {
    const f = fixture(); f.caller.rpc.mockImplementation(async () => { throw new Error("private error body"); });
    expect(await readWeeklyOwner(f.scope, f.caller, f.current)).toEqual({ status: "unavailable" });
  });
});
