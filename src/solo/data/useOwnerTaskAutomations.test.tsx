import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerTaskControl, OwnerTaskRead, OwnerTaskReview, OwnerTaskScope } from "./ownerTaskAutomation";
const m = vi.hoisted(() => ({ context: { activeUserId: "owner", activeTenantId: "tenant", loading: false, accountContextLoading: false, accountContextStatus: "ready" },
  impersonating: false, auth: null as null | (() => void), unsubscribe: vi.fn(), read: vi.fn(), control: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => m.context }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: m.impersonating }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (callback: () => void) => {
  m.auth = callback; return { data: { subscription: { unsubscribe: m.unsubscribe } } };
} } } }));
vi.mock("./ownerTaskAutomation", () => ({ readOwnerTaskAutomations: (...args: unknown[]) => m.read(...args), controlOwnerTaskAutomation: (...args: unknown[]) => m.control(...args) }));
import { useOwnerTaskAutomations } from "./useOwnerTaskAutomations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots = new Set<Root>();
function renderHook(hook: typeof useOwnerTaskAutomations) {
  const root = createRoot(document.createElement("div")); roots.add(root);
  const result = { current: null as unknown as ReturnType<typeof useOwnerTaskAutomations> };
  function Probe() { result.current = hook(); return null; }
  const rerender = () => act(() => { root.render(<Probe />); }); rerender();
  return { result, rerender, unmount: () => { act(() => root.unmount()); roots.delete(root); } };
}
const waitFor = async (assertion: () => void) => { await act(async () => {}); assertion(); };
const cleanup = () => { act(() => { for (const root of roots) root.unmount(); }); roots.clear(); };

const review = (tenant = "tenant", name = "Review new contact"): OwnerTaskReview => ({ id: "process", updatedAt: "2026-10-16T12:00:00.123456Z",
  process: { id: "process", tenant_id: tenant, name, state: "draft", granted_lane: "confirm" }, acts: [] });
const ready = (tenant = "tenant", name?: string): OwnerTaskRead => ({ status: "ready", items: [review(tenant, name)], hasMore: false });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  m.context = { activeUserId: "owner", activeTenantId: "tenant", loading: false, accountContextLoading: false, accountContextStatus: "ready" };
  m.impersonating = false; m.auth = null; m.unsubscribe.mockReset(); m.read.mockReset(); m.control.mockReset();
  m.read.mockImplementation(async (scope: OwnerTaskScope) => ready(scope.tenantId)); m.control.mockResolvedValue({ status: "saved", state: "live" });
});
afterEach(cleanup);
async function loaded() {
  const hook = renderHook(useOwnerTaskAutomations);
  await waitFor(() => expect(hook.result.current.read.status).toBe("ready")); return hook;
}
const item = (read: OwnerTaskRead) => { if (read.status !== "ready") throw new Error("not ready"); return read.items[0]; };
describe("ordinary owner task UI interaction fencing", () => {
  it("loads canonical configuration; manual refresh performs only canonical reads", async () => {
    const h = await loaded(); expect(m.read).toHaveBeenCalledTimes(1);
    await act(async () => { await h.result.current.refresh(); });
    expect(m.read).toHaveBeenCalledTimes(2); expect(m.control).not.toHaveBeenCalled();
  });
  it("denies duplicate clicks and refresh while saving, then requires fresh read rather than replay", async () => {
    const pending = deferred<OwnerTaskControl>(); m.control.mockReturnValue(pending.promise);
    const h = await loaded(), reviewed = item(h.result.current.read); let first!: Promise<OwnerTaskControl>;
    await act(async () => { first = h.result.current.control(reviewed, "arm");
      expect(await h.result.current.control(reviewed, "arm")).toEqual({ status: "busy" }); await h.result.current.refresh(); });
    expect(m.control).toHaveBeenCalledTimes(1); expect(m.read).toHaveBeenCalledTimes(1); expect(h.result.current.busy).toBe(true);
    await act(async () => { pending.resolve({ status: "saved", state: "live" }); await first; });
    expect(h.result.current.busy).toBe(false); expect(h.result.current.needsRefresh).toBe(true); expect(m.read).toHaveBeenCalledTimes(1);
    expect(await h.result.current.control(reviewed, "arm")).toEqual({ status: "refused" }); expect(m.control).toHaveBeenCalledTimes(1);
  });
  it.each(["unknown", "stale", "busy", "unavailable", "unsupported", "refused"] as const)("retains truthful %s without automatic retry or readback", async status => {
    m.control.mockResolvedValue({ status }); const h = await loaded();
    await act(async () => { await h.result.current.control(item(h.result.current.read), "arm"); });
    expect(h.result.current.feedback?.result.status).toBe(status); expect(h.result.current.needsRefresh).toBe(true);
    expect(m.control).toHaveBeenCalledTimes(1); expect(m.read).toHaveBeenCalledTimes(1);
  });
  it("a thrown control remains unknown and releases the pending interaction", async () => {
    m.control.mockRejectedValue(new TypeError("transport interrupted")); const h = await loaded();
    await act(async () => { await h.result.current.control(item(h.result.current.read), "pause"); });
    expect(h.result.current.busy).toBe(false); expect(h.result.current.feedback?.result.status).toBe("unknown"); expect(m.control).toHaveBeenCalledTimes(1);
  });
  it("does not mistake a read failure for an empty account", async () => {
    m.read.mockRejectedValue(new TypeError("read interrupted")); const h = renderHook(useOwnerTaskAutomations);
    await waitFor(() => expect(h.result.current.read.status).toBe("unavailable")); expect(m.control).not.toHaveBeenCalled();
  });
  it("discards a late prior-workspace read, including leave and return to the same account", async () => {
    const old = deferred<OwnerTaskRead>(); m.read.mockReturnValueOnce(old.promise); const h = renderHook(useOwnerTaskAutomations);
    m.context = { ...m.context, activeTenantId: "other" }; h.rerender();
    await waitFor(() => expect(h.result.current.read.status).toBe("ready")); expect(item(h.result.current.read).process.tenant_id).toBe("other");
    const key = h.result.current.scopeKey;
    m.context = { ...m.context, activeTenantId: "tenant" }; h.rerender(); await waitFor(() => expect(h.result.current.read.status).toBe("ready"));
    await act(async () => { old.resolve(ready("tenant", "Old delayed version")); });
    expect(h.result.current.scopeKey).not.toBe(key); expect(item(h.result.current.read).process.name).toBe("Review new contact");
    expect(await h.result.current.control(review(), "arm")).toEqual({ status: "refused" }); expect(m.control).not.toHaveBeenCalled();
  });
  it("does not publish an old workspace's late control acknowledgement", async () => {
    const pending = deferred<OwnerTaskControl>(); m.control.mockReturnValue(pending.promise); const h = await loaded(); let request!: Promise<OwnerTaskControl>;
    await act(async () => { request = h.result.current.control(item(h.result.current.read), "arm"); });
    m.context = { ...m.context, activeTenantId: "other" }; h.rerender(); await waitFor(() => expect(h.result.current.read.status).toBe("ready"));
    await act(async () => { pending.resolve({ status: "saved", state: "live" }); expect(await request).toEqual({ status: "refused" }); });
    expect(item(h.result.current.read).process.tenant_id).toBe("other"); expect(h.result.current.feedback).toBeNull(); expect(h.result.current.busy).toBe(false);
  });
  it.each(["auth", "impersonation"])("expires the captured review on %s and requires a fresh ordinary read", async change => {
    const h = await loaded(), oldReview = item(h.result.current.read), oldScope = h.result.current.scopeKey;
    if (change === "auth") { await act(async () => { m.auth!(); }); }
    else { m.impersonating = true; h.rerender(); expect(h.result.current.read.status).toBe("refused"); m.impersonating = false; h.rerender(); }
    await waitFor(() => expect(h.result.current.read.status).toBe("ready")); expect(h.result.current.scopeKey).not.toBe(oldScope);
    expect(await h.result.current.control(oldReview, "arm")).toEqual({ status: "refused" }); expect(m.control).not.toHaveBeenCalled();
  });
  it("refuses an impersonated/anonymous/unresolved view without reading or controlling", async () => {
    m.impersonating = true; const h = renderHook(useOwnerTaskAutomations); expect(h.result.current.read.status).toBe("refused");
    expect(await h.result.current.control(review(), "arm")).toEqual({ status: "refused" }); expect(m.read).not.toHaveBeenCalled(); expect(m.control).not.toHaveBeenCalled();
    m.impersonating = false; m.context = { ...m.context, loading: true }; h.rerender(); expect(h.result.current.read.status).toBe("loading"); expect(m.read).not.toHaveBeenCalled();
  });
  it("unmount invalidates the actual helper's captured scope and unsubscribes auth", async () => {
    const pending = deferred<OwnerTaskRead>(); m.read.mockReturnValue(pending.promise); const h = renderHook(useOwnerTaskAutomations);
    const current = m.read.mock.calls[0][2] as () => OwnerTaskScope | null; expect(current()).not.toBeNull(); h.unmount(); expect(current()).toBeNull();
    await act(async () => { pending.resolve(ready()); }); expect(m.unsubscribe).toHaveBeenCalledTimes(1); expect(m.control).not.toHaveBeenCalled();
  });
});
