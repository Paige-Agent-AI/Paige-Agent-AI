import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePortalInvitations } from "./usePortalInvitations";
const actor = "e0911000-0000-0000-0000-000000000001", other = "e0911000-0000-0000-0000-000000000002";
const tenant = "e0921000-0000-0000-0000-000000000001", foreign = "e0921000-0000-0000-0000-000000000002";
const fixture = vi.hoisted(() => ({ context: { activeTenantId: "", activeUserId: "", accountContextStatus: "ready", accountContextLoading: false },
  getUser: vi.fn(), rpc: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  signal: null as AbortSignal | null, reply: null as unknown, error: null as unknown, deferred: null as Promise<unknown> | null }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: () => fixture.getUser(), onAuthStateChange: (callback: typeof fixture.auth) => { fixture.auth = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  rpc: (...args: unknown[]) => { fixture.rpc(...args); return { abortSignal: (signal: AbortSignal) => { fixture.signal = signal; return fixture.deferred ?? Promise.resolve({ data: fixture.reply, error: fixture.error }); } }; },
  from: () => { throw new Error("Raw invitation/email tables are not a client read contract"); },
} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, read: ReturnType<typeof usePortalInvitations>;
function Subject({ tenantId }: { tenantId: string }) { read = usePortalInvitations(tenantId); return <output>{read.isError ? "failed" : read.data ? read.data.length + " invitations" : "waiting"}</output>; }
const show = async (tenantId = tenant) => { await act(async () => root.render(<QueryClientProvider client={client}><Subject tenantId={tenantId} /></QueryClientProvider>)); };
const saved = { id: "e0941000-0000-0000-0000-000000000001", contact_id: "e0931000-0000-0000-0000-000000000001", email: "client@example.test",
  created_at: "2026-10-15T12:00:00Z", expires_at: "2026-11-15T12:00:00Z", revoked_at: null, last_used_at: null, delivery: { history: [], truncated: false } };
beforeEach(() => { fixture.context = { activeTenantId: tenant, activeUserId: actor, accountContextStatus: "ready", accountContextLoading: false };
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: actor } }, error: null }); fixture.rpc.mockReset(); fixture.error = null; fixture.deferred = null;
  fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [] }; fixture.auth = null; fixture.signal = null;
  host = document.createElement("div"); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); client.clear(); });
it("uses the exact actor/business native read and verifies Auth before and after", async () => {
  await show(); await vi.waitFor(() => expect(host.textContent).toBe("0 invitations"));
  expect(fixture.rpc).toHaveBeenCalledWith("client_portal_owner_invitations", { p_expected_actor_id: actor, p_expected_tenant_id: tenant });
  expect(fixture.signal).toBeInstanceOf(AbortSignal); expect(fixture.getUser).toHaveBeenCalledTimes(2);
});
it("does not use a foreign route as authority", async () => { await show(foreign); expect(fixture.getUser).not.toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled(); });
it("refuses a mismatching SDK subject", async () => { fixture.getUser.mockResolvedValue({ data: { user: { id: other } }, error: null }); await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); expect(fixture.rpc).not.toHaveBeenCalled(); });
it("refuses an actor change during a read", async () => { fixture.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null }).mockResolvedValue({ data: { user: { id: other } }, error: null }); await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); expect(read.data).toBeUndefined(); });
it.each(["denial", "widened", "foreign", "overflow"])("keeps %s distinct from empty history", async mode => {
  if (mode === "denial") fixture.error = { code: "42501", message: "private backend detail" };
  if (mode === "widened") fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [], token: "private" };
  if (mode === "foreign") fixture.reply = { actor_id: actor, tenant_id: foreign, invitations: [] };
  if (mode === "overflow") fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: Array(1001).fill(saved) };
  await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); expect(read.data).toBeUndefined();
});
it("isolates caches and arguments after switching actor/business", async () => {
  fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [saved] }; await show(); await vi.waitFor(() => expect(host.textContent).toBe("1 invitations"));
  fixture.context.activeUserId = other; fixture.context.activeTenantId = foreign; fixture.getUser.mockResolvedValue({ data: { user: { id: other } }, error: null });
  fixture.reply = { actor_id: other, tenant_id: foreign, invitations: [] }; await show(foreign); await vi.waitFor(() => expect(host.textContent).toBe("0 invitations"));
  expect(fixture.rpc).toHaveBeenLastCalledWith("client_portal_owner_invitations", { p_expected_actor_id: other, p_expected_tenant_id: foreign });
});
it("retires cached history on sign-out before owner context updates", async () => {
  fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [saved] }; await show(); await vi.waitFor(() => expect(host.textContent).toBe("1 invitations"));
  await act(async () => fixture.auth!("SIGNED_OUT", null)); expect(read.data).toBeUndefined(); expect(host.textContent).toBe("failed");
});
it("ignores late data and recovers with a fresh same-actor native read", async () => {
  let finish!: (value: unknown) => void; fixture.deferred = new Promise(resolve => { finish = resolve; }); await show();
  await vi.waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(1)); await act(async () => fixture.auth!("SIGNED_OUT", null));
  await act(async () => finish({ data: { actor_id: actor, tenant_id: tenant, invitations: [saved] }, error: null })); expect(read.data).toBeUndefined();
  fixture.deferred = null; await act(async () => fixture.auth!("SIGNED_IN", { user: { id: actor } }));
  await vi.waitFor(() => expect(host.textContent).toBe("0 invitations")); expect(fixture.rpc).toHaveBeenCalledTimes(2);
});
it("preserves same-actor refresh and reloads canonical evidence on invalidation", async () => {
  fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [saved] }; await show(); await vi.waitFor(() => expect(host.textContent).toBe("1 invitations"));
  await act(async () => fixture.auth!("TOKEN_REFRESHED", { user: { id: actor } })); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  fixture.reply = { actor_id: actor, tenant_id: tenant, invitations: [] }; await act(async () => { await read.invalidate(); });
  await vi.waitFor(() => expect(host.textContent).toBe("0 invitations")); expect(fixture.rpc).toHaveBeenCalledTimes(2);
});
