import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalConfigurationGate } from "./PortalConfigurationGate";

const fixture = vi.hoisted(() => ({
  context: { activeTenantId: "tenant-a", activeUserId: "actor-a", accountContextStatus: "ready", accountContextLoading: false, isPlatformOwner: false, isPlatformStaff: false },
  globalAdmin: false,
  getUser: vi.fn(), rpc: vi.fn(), unsubscribe: vi.fn(),
  listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/hooks/useUserRoles", () => ({ useUserRoles: () => ({ loading: false, roles: fixture.globalAdmin ? ["admin"] : ["user"], isAdmin: fixture.globalAdmin }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => fixture.rpc(...args),
  auth: { getUser: () => fixture.getUser(), onAuthStateChange: (listener: typeof fixture.listener) => {
    fixture.listener = listener; return { data: { subscription: { unsubscribe: fixture.unsubscribe } } };
  } },
} }));

function Subject({ tenantId = "tenant-a" }: { tenantId?: string }) { return <PortalConfigurationGate tenantId={tenantId}><input aria-label="Portal welcome" defaultValue="Saved greeting" /></PortalConfigurationGate>; }
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const show = async (tenantId = "tenant-a") => { await act(async () => root.render(<Subject tenantId={tenantId} />)); };
const editor = () => host.querySelector<HTMLInputElement>('input[aria-label="Portal welcome"]');
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const permission = (data: boolean) => ({ data, error: null });

beforeEach(() => {
  fixture.context = { activeTenantId: "tenant-a", activeUserId: "actor-a", accountContextStatus: "ready", accountContextLoading: false, isPlatformOwner: false, isPlatformStaff: false };
  fixture.globalAdmin = false; fixture.listener = null;
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: "actor-a" } }, error: null });
  fixture.rpc.mockReset().mockResolvedValue({ data: true, error: null }); fixture.unsubscribe.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Portal configuration uses the writer's tenant authority", () => {
  it("admits a verified tenant owner without a global admin label", async () => {
    await show(); expect(editor()).not.toBeNull();
    expect(fixture.rpc).toHaveBeenCalledWith("can_manage_tenant_brand", { _tenant_id: "tenant-a" });
  });
  it("does not treat a global admin label as authority over the selected tenant", async () => {
    fixture.globalAdmin = true; fixture.rpc.mockResolvedValue({ data: false, error: null });
    await show(); expect(editor()).toBeNull();
  });
  it("does not use an unresolved workspace as a grant", async () => {
    fixture.globalAdmin = true; fixture.context.accountContextLoading = true;
    await show(); expect(editor()).toBeNull(); expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("requires the independently verified Auth actor to match the accepted account actor", async () => {
    fixture.globalAdmin = true; fixture.getUser.mockResolvedValue({ data: { user: { id: "actor-b" } }, error: null });
    await show(); expect(editor()).toBeNull(); expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not fall back to a global role when the permission read fails", async () => {
    fixture.globalAdmin = true; fixture.rpc.mockResolvedValue({ data: null, error: new Error("private server detail") });
    await show(); expect(editor()).toBeNull(); expect(host.textContent).not.toContain("private server detail");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("accepts only the exact affirmative boolean contract", async () => {
    fixture.globalAdmin = true; fixture.rpc.mockResolvedValue({ data: "true", error: null });
    await show(); expect(editor()).toBeNull();
  });
  it("does not mount the editor while the canonical read is pending", async () => {
    const pending = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValue(pending.promise);
    await show(); expect(editor()).toBeNull(); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => pending.resolve(permission(true))); expect(editor()).not.toBeNull();
  });
  it("refuses a target different from the accepted active workspace", async () => {
    await show("tenant-other"); expect(editor()).toBeNull(); expect(fixture.getUser).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not query permission without an Auth user", async () => {
    fixture.getUser.mockResolvedValue({ data: { user: null }, error: null }); await show();
    expect(editor()).toBeNull(); expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not use an Auth response carrying an error", async () => {
    fixture.getUser.mockResolvedValue({ data: { user: { id: "actor-a" } }, error: new Error("private Auth detail") });
    await show(); expect(editor()).toBeNull(); expect(fixture.rpc).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("private Auth detail");
  });
  it.each(["Auth", "permission"])("contains a thrown %s error and permits an explicit retry", async (source) => {
    const failing = source === "Auth" ? fixture.getUser : fixture.rpc;
    failing.mockRejectedValueOnce(new Error("private exception")); await show();
    expect(editor()).toBeNull(); expect(host.textContent).not.toContain("private exception");
    const retry = host.querySelector<HTMLButtonElement>("button"); expect(retry?.textContent).toBe("Retry access check");
    await act(async () => retry?.click()); expect(editor()).not.toBeNull();
  });
  it("retires an old affirmative reply after changing tenants", async () => {
    const old = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValueOnce(old.promise).mockResolvedValue(permission(false));
    await show(); fixture.context.activeTenantId = "tenant-b"; await show("tenant-b");
    await act(async () => old.resolve(permission(true))); expect(editor()).toBeNull();
    expect(fixture.rpc).toHaveBeenLastCalledWith("can_manage_tenant_brand", { _tenant_id: "tenant-b" });
  });
  it("does not let an obsolete denial retire the new tenant's editor", async () => {
    const old = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValueOnce(old.promise);
    await show(); fixture.context.activeTenantId = "tenant-b"; await show("tenant-b"); expect(editor()).not.toBeNull();
    const current = editor(); await act(async () => old.resolve(permission(false))); expect(editor()).toBe(current);
  });
  it("retires an old actor's pending permission on an identity switch", async () => {
    const old = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValueOnce(old.promise).mockResolvedValue(permission(false));
    await show(); fixture.context.activeUserId = "actor-b";
    fixture.getUser.mockResolvedValue({ data: { user: { id: "actor-b" } }, error: null }); await show();
    await act(async () => old.resolve(permission(true))); expect(editor()).toBeNull();
  });
  it("does not reuse an old permission after context becomes unresolved and returns", async () => {
    await show(); expect(editor()).not.toBeNull(); fixture.context.accountContextLoading = true; await show(); expect(editor()).toBeNull();
    const next = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValue(next.promise);
    fixture.context.accountContextLoading = false; await show(); expect(editor()).toBeNull();
    await act(async () => next.resolve(permission(false))); expect(editor()).toBeNull();
  });
  it("retires a pending permission on sign-out", async () => {
    const old = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValue(old.promise); await show();
    act(() => fixture.listener?.("SIGNED_OUT", null)); await act(async () => old.resolve(permission(true))); expect(editor()).toBeNull();
  });
  it("retires the editor before checking an Auth actor that differs from context", async () => {
    await show(); expect(editor()).not.toBeNull(); fixture.getUser.mockResolvedValue({ data: { user: { id: "actor-b" } }, error: null });
    await act(async () => fixture.listener?.("SIGNED_IN", { user: { id: "actor-b" } }));
    expect(editor()).toBeNull(); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("verifies uncertain initial-session data outside the Auth callback", async () => {
    await show(); let insideCallback = false;
    fixture.getUser.mockImplementation(async () => { expect(insideCallback).toBe(false); return { data: { user: { id: "actor-a" } }, error: null }; });
    await act(async () => { insideCallback = true; fixture.listener?.("INITIAL_SESSION", null); insideCallback = false; });
    expect(fixture.getUser).toHaveBeenCalledTimes(2); expect(editor()).not.toBeNull();
  });
  it("cancels a queued Auth recheck when sign-out arrives before it runs", async () => {
    await show(); await act(async () => { fixture.listener?.("INITIAL_SESSION", null); fixture.listener?.("SIGNED_OUT", null); });
    expect(editor()).toBeNull(); expect(fixture.getUser).toHaveBeenCalledTimes(1);
  });
  it("preserves an unsaved editor across routine same-actor Auth events", async () => {
    await show(); const before = editor()!; before.value = "Unsaved greeting";
    await act(async () => { for (const event of ["TOKEN_REFRESHED", "SIGNED_IN", "INITIAL_SESSION"]) fixture.listener?.(event, { user: { id: "actor-a" } }); });
    expect(editor()).toBe(before); expect(editor()?.value).toBe("Unsaved greeting"); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("unsubscribes and ignores pending or queued work after unmount", async () => {
    const old = deferred<ReturnType<typeof permission>>(); fixture.rpc.mockReturnValue(old.promise); await show();
    await act(async () => { fixture.listener?.("INITIAL_SESSION", null); root.unmount(); });
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1); const calls = fixture.getUser.mock.calls.length;
    await act(async () => old.resolve(permission(true))); expect(host.textContent).toBe(""); expect(fixture.getUser).toHaveBeenCalledTimes(calls);
    root = createRoot(host);
  });
});
