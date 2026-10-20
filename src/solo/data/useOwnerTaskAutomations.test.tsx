import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerTaskControl, OwnerTaskRead, OwnerTaskReview, OwnerTaskScope } from "./ownerTaskAutomation";
const m = vi.hoisted(() => ({ context: { activeUserId: "owner", activeTenantId: "tenant", loading: false, accountContextLoading: false, accountContextStatus: "ready" },
  impersonating: false, auth: null as null | (() => void), unsubscribe: vi.fn(), read: vi.fn(), control: vi.fn(), history: vi.fn(), outcome: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => m.context }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: m.impersonating }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (callback: () => void) => {
  m.auth = callback; return { data: { subscription: { unsubscribe: m.unsubscribe } } };
} } } }));
vi.mock("./ownerTaskAutomation", () => ({ readOwnerTaskAutomations: (...args: unknown[]) => m.read(...args), controlOwnerTaskAutomation: (...args: unknown[]) => m.control(...args),
  readOwnerTaskHistoryList: (...args: unknown[]) => m.history(...args), readOwnerTaskOutcome: (...args: unknown[]) => m.outcome(...args) }));
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
  m.history.mockReset(); m.outcome.mockReset();
  m.history.mockResolvedValue({ status: "ready", items: [locator()], hasMore: false });
  m.outcome.mockResolvedValue({ status: "unavailable" });
});

const processId = "11111111-1111-4111-8111-111111111111";
const locator = (id = "22222222-2222-4222-8222-222222222222") => ({
  approvalId: id, occurrenceId: "33333333-3333-4333-8333-333333333333",
  updatedAt: "2026-10-20T00:00:00Z", approvalStatus: "approved",
});
const historyReview = (id = processId): OwnerTaskReview => ({
  ...review(), id, process: { ...review().process, id, state: "paused" },
});
async function historyLoaded(reviews = [historyReview()]) {
  m.read.mockResolvedValue({ status: "ready", items: reviews, hasMore: false });
  return loaded();
}
function historyRow(h: Awaited<ReturnType<typeof historyLoaded>>, index = 0) {
  const view = h.result.current.history;
  if (view.status !== "ready") throw new Error("history not ready");
  return view.list.items[index];
}
describe("original process history interaction lifetime", () => {
  it("retires captured reader authority during layout unmount before passive cleanup", async () => {
    const root = createRoot(document.createElement("div")); roots.add(root);
    let inspect = false, observed: OwnerTaskScope | null | undefined;
    function Probe() { useOwnerTaskAutomations(); return null; }
    function Frame({ show }: { show: boolean }) {
      useLayoutEffect(() => {
        if (inspect) observed = (m.read.mock.calls[0][2] as () => OwnerTaskScope | null)();
      });
      return show ? <Probe /> : null;
    }
    await act(async () => { root.render(<Frame show />); });
    expect(m.read).toHaveBeenCalledTimes(1);
    inspect = true;
    await act(async () => { root.render(<Frame show={false} />); });
    expect(observed).toBeNull();
  });
  it("reads a paused process only on deliberate inspection without changing its configuration", async () => {
    const h = await historyLoaded(), config = h.result.current.read;
    expect(h.result.current.history.status).toBe("closed");
    await act(async () => { await h.result.current.openHistory(item(config)); });
    expect(h.result.current.history.status).toBe("ready");
    expect(historyRow(h).approvalId).toBe(locator().approvalId);
    expect(h.result.current.read).toBe(config);
    await act(async () => { await h.result.current.inspectOutcome(historyRow(h)); });
    expect(m.outcome).toHaveBeenCalledTimes(1);
    expect(m.outcome.mock.calls[0][1]).toEqual({ processId, approvalId: locator().approvalId, occurrenceId: locator().occurrenceId });
    expect(m.read).toHaveBeenCalledTimes(1); expect(m.control).not.toHaveBeenCalled();
  });
  it("rejects forged process and locator objects and expired reviews after refresh", async () => {
    const h = await historyLoaded(), original = item(h.result.current.read);
    await act(async () => { await h.result.current.openHistory({ ...original }); });
    expect(m.history).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.openHistory(original); });
    const row = historyRow(h);
    await act(async () => { await h.result.current.inspectOutcome({ ...row }); });
    expect(m.outcome).not.toHaveBeenCalled();
    m.read.mockResolvedValueOnce({ status: "ready", items: [historyReview()], hasMore: false });
    await act(async () => { await h.result.current.refresh(); await h.result.current.openHistory(original); await h.result.current.inspectOutcome(row); });
    expect(h.result.current.history.status).toBe("closed");
    expect(m.history).toHaveBeenCalledTimes(1); expect(m.outcome).not.toHaveBeenCalled();
  });
  it("close retires a pending read synchronously and never exposes its late result", async () => {
    const pending = deferred<unknown>(); m.history.mockReturnValue(pending.promise);
    const h = await historyLoaded(); let request!: Promise<void>;
    act(() => { request = h.result.current.openHistory(item(h.result.current.read)); });
    const current = m.history.mock.calls[0][3] as () => OwnerTaskScope | null;
    expect(current()).not.toBeNull();
    act(() => { h.result.current.closeHistory(); expect(current()).toBeNull(); });
    await act(async () => { pending.resolve({ status: "ready", items: [locator()], hasMore: false }); expect(await request).toBeUndefined(); });
    expect(h.result.current.history.status).toBe("closed"); expect(m.outcome).not.toHaveBeenCalled();
  });
  it("history close and late reads cannot clear an active configuration control or unknown feedback", async () => {
    const pending = deferred<OwnerTaskControl>(); m.control.mockReturnValue(pending.promise);
    const h = await historyLoaded(), original = item(h.result.current.read); let request!: Promise<OwnerTaskControl>;
    act(() => { request = h.result.current.control(original, "pause"); });
    await act(async () => { h.result.current.closeHistory(); await h.result.current.openHistory(original); });
    expect(h.result.current.busy).toBe(true); expect(m.history).not.toHaveBeenCalled();
    expect(await h.result.current.control(original, "arm")).toEqual({ status: "busy" });
    await act(async () => { pending.resolve({ status: "unknown" }); await request; });
    await act(async () => { h.result.current.closeHistory(); await h.result.current.openHistory(original); });
    expect(h.result.current.feedback?.result.status).toBe("unknown");
    expect(h.result.current.needsRefresh).toBe(true); expect(m.history).not.toHaveBeenCalled();
    expect(m.control).toHaveBeenCalledTimes(1); expect(m.read).toHaveBeenCalledTimes(1);
  });
});
afterEach(cleanup);
async function loaded() {
  const hook = renderHook(useOwnerTaskAutomations);
  await waitFor(() => expect(hook.result.current.read.status).toBe("ready")); return hook;
}
const item = (read: OwnerTaskRead) => { if (read.status !== "ready") throw new Error("not ready"); return read.items[0]; };
describe("original history races and truthful states", () => {
  it("retires older process A→B→A reads without stranding the final selection", async () => {
    const a = historyReview(), b = historyReview("44444444-4444-4444-8444-444444444444");
    const first = deferred<unknown>(), second = deferred<unknown>();
    m.history.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = await historyLoaded([a, b]); let oldA!: Promise<void>, oldB!: Promise<void>;
    act(() => { oldA = h.result.current.openHistory(a); oldB = h.result.current.openHistory(b); });
    await act(async () => { await h.result.current.openHistory(a); });
    const finalView = h.result.current.history;
    await act(async () => { first.resolve({ status: "refused" }); second.resolve({ status: "unavailable" }); await oldA; await oldB; });
    expect(h.result.current.history).toBe(finalView);
    expect(finalView.status).toBe("ready"); expect(m.history).toHaveBeenCalledTimes(3);
  });
  it("retires older approval A→B→A replies and publishes only the latest original outcome", async () => {
    m.history.mockResolvedValue({ status: "ready", items: [locator(), locator("55555555-5555-4555-8555-555555555555")], hasMore: true });
    const first = deferred<unknown>(), second = deferred<unknown>();
    m.outcome.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce({ status: "refused" });
    const h = await historyLoaded();
    await act(async () => { await h.result.current.openHistory(item(h.result.current.read)); });
    const a = historyRow(h), b = historyRow(h, 1); let oldA!: Promise<void>, oldB!: Promise<void>;
    act(() => { oldA = h.result.current.inspectOutcome(a); oldB = h.result.current.inspectOutcome(b); });
    await act(async () => { await h.result.current.inspectOutcome(a); });
    const finalView = h.result.current.history;
    await act(async () => { first.resolve({ status: "ready", secret: "obsolete-a" }); second.resolve({ status: "ready", secret: "obsolete-b" }); await oldA; await oldB; });
    expect(h.result.current.history).toBe(finalView);
    expect(finalView).toMatchObject({ status: "ready", selected: a, outcome: { status: "refused" }, list: { hasMore: true } });
    expect(m.control).not.toHaveBeenCalled();
  });
  it.each(["list", "detail"] as const)("drops a pending %s through workspace A→B→A", async stage => {
    const pending = deferred<unknown>(); const h = await historyLoaded();
    let request!: Promise<void>;
    if (stage === "list") {
      m.history.mockReturnValueOnce(pending.promise);
      act(() => { request = h.result.current.openHistory(item(h.result.current.read)); });
    } else {
      await act(async () => { await h.result.current.openHistory(item(h.result.current.read)); });
      m.outcome.mockReturnValueOnce(pending.promise);
      act(() => { request = h.result.current.inspectOutcome(historyRow(h)); });
    }
    const captured = (stage === "list" ? m.history.mock.calls.at(-1)![3] : m.outcome.mock.calls.at(-1)![4]) as () => OwnerTaskScope | null;
    m.context = { ...m.context, activeTenantId: "other" }; h.rerender();
    expect(captured()).toBeNull();
    m.context = { ...m.context, activeTenantId: "tenant" }; h.rerender();
    await act(async () => { pending.resolve({ status: "ready", items: [locator()], hasMore: false }); await request; });
    expect(h.result.current.history.status).toBe("closed"); expect(captured()).toBeNull();
  });
  it.each(["auth", "impersonation", "loading", "resolving", "account-loading", "actor"] as const)("retires history on %s before late outcome publication", async change => {
    const h = await historyLoaded(); await act(async () => { await h.result.current.openHistory(item(h.result.current.read)); });
    const pending = deferred<unknown>(); m.outcome.mockReturnValueOnce(pending.promise); let request!: Promise<void>;
    act(() => { request = h.result.current.inspectOutcome(historyRow(h)); });
    const captured = m.outcome.mock.calls[0][4] as () => OwnerTaskScope | null;
    if (change === "auth") act(() => { m.auth!(); expect(captured()).toBeNull(); });
    else {
      if (change === "impersonation") m.impersonating = true;
      if (change === "loading") m.context = { ...m.context, loading: true };
      if (change === "resolving") m.context = { ...m.context, accountContextStatus: "resolving" };
      if (change === "account-loading") m.context = { ...m.context, accountContextLoading: true };
      if (change === "actor") m.context = { ...m.context, activeUserId: "next-owner" };
      h.rerender(); expect(captured()).toBeNull();
    }
    await act(async () => { pending.resolve({ status: "ready", secret: "old-scope" }); await request; });
    expect(h.result.current.history.status).toBe("closed"); expect(m.control).not.toHaveBeenCalled();
  });
  it("a configuration control retires an older history response without losing unknown feedback", async () => {
    const pending = deferred<unknown>(); m.history.mockReturnValueOnce(pending.promise); m.control.mockResolvedValueOnce({ status: "unknown" });
    const h = await historyLoaded(), original = item(h.result.current.read); let request!: Promise<void>;
    act(() => { request = h.result.current.openHistory(original); });
    await act(async () => { await h.result.current.control(original, "arm"); });
    await act(async () => { pending.resolve({ status: "ready", items: [locator()], hasMore: false }); await request; });
    expect(h.result.current.history.status).toBe("closed");
    expect(h.result.current.needsRefresh).toBe(true); expect(h.result.current.feedback?.result.status).toBe("unknown");
    expect(m.control).toHaveBeenCalledTimes(1); expect(m.read).toHaveBeenCalledTimes(1);
  });
  it("history interaction cannot strand a concurrent deliberate configuration refresh", async () => {
    const h = await historyLoaded(), original = item(h.result.current.read);
    const pending = deferred<OwnerTaskRead>(); m.read.mockReturnValueOnce(pending.promise); let request!: Promise<void>;
    act(() => { request = h.result.current.refresh(); });
    await act(async () => { await h.result.current.openHistory(original); h.result.current.closeHistory(); });
    const next = { status: "ready" as const, items: [historyReview()], hasMore: false };
    await act(async () => { pending.resolve(next); await request; });
    expect(h.result.current.read).toBe(next); expect(h.result.current.history.status).toBe("closed");
    expect(m.history).not.toHaveBeenCalled();
  });
  it.each(["refused", "unavailable", "throw"] as const)("keeps finite %s list state and preserves the process review", async status => {
    const h = await historyLoaded(), config = h.result.current.read;
    if (status === "throw") m.history.mockRejectedValueOnce(new Error("transport"));
    else m.history.mockResolvedValueOnce({ status });
    await act(async () => { await h.result.current.openHistory(item(config)); });
    expect(h.result.current.history.status).toBe(status === "throw" ? "unavailable" : status);
    expect(h.result.current.read).toBe(config); expect(m.control).not.toHaveBeenCalled();
  });
  it("preserves exact empty/truncated list truth and seals returned locators against mutation", async () => {
    const h = await historyLoaded(), original = item(h.result.current.read);
    m.history.mockResolvedValueOnce({ status: "ready", items: [], hasMore: false });
    await act(async () => { await h.result.current.openHistory(original); });
    expect(h.result.current.history).toMatchObject({ status: "ready", list: { items: [], hasMore: false } });
    await act(async () => { await h.result.current.openHistory(original); });
    const row = historyRow(h);
    const view = h.result.current.history;
    if (view.status !== "ready") throw new Error("not ready");
    const foreign = locator("66666666-6666-4666-8666-666666666666");
    try { Object.assign(row, foreign); } catch { /* Immutable projection may reject the edit. */ }
    try { Object.assign(view, { processId: "77777777-7777-4777-8777-777777777777" }); } catch { /* Same original identity. */ }
    try { Object.assign(view.list, { items: [foreign, row] }); } catch { /* No injected locator. */ }
    await act(async () => { await h.result.current.inspectOutcome(row); });
    expect(m.outcome.mock.calls[0][1]).toEqual({ processId, approvalId: locator().approvalId, occurrenceId: locator().occurrenceId });
    await act(async () => { await h.result.current.inspectOutcome(foreign); });
    expect(m.outcome).toHaveBeenCalledTimes(1);
  });
});
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
