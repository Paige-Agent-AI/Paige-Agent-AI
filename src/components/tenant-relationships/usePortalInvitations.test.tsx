import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePortalInvitations } from "./usePortalInvitations";
const fixture = vi.hoisted(() => ({ context: { activeTenantId: "test-tenant-a", activeUserId: "test-actor-a", accountContextStatus: "ready", accountContextLoading: false }, getUser: vi.fn(), reads: [] as Array<{ columns: string; filters: unknown[][]; signal?: AbortSignal }>, rows: [] as unknown[], error: null as unknown }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: () => fixture.getUser() }, from: (table: string) => {
  expect(table).toBe("tenant_invite_tokens"); const read = { columns: "", filters: [] as unknown[][], signal: undefined as AbortSignal | undefined }; fixture.reads.push(read);
  const chain = { select: (columns: string) => { read.columns = columns; return chain; }, eq: (...args: unknown[]) => { read.filters.push(args); return chain; }, order: () => chain, limit: () => chain, abortSignal: (signal: AbortSignal) => { read.signal = signal; return Promise.resolve({ data: fixture.rows, error: fixture.error }); } }; return chain;
} } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let client: QueryClient;
function Subject({ tenantId }: { tenantId: string }) { const read = usePortalInvitations(tenantId); return <output>{read.isError ? "failed" : read.data ? `${read.data.length} invitations` : "waiting"}</output>; }
const show = async (tenantId = "test-tenant-a") => { await act(async () => root.render(<QueryClientProvider client={client}><Subject tenantId={tenantId} /></QueryClientProvider>)); };
beforeEach(() => { fixture.context = { activeTenantId: "test-tenant-a", activeUserId: "test-actor-a", accountContextStatus: "ready", accountContextLoading: false }; fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-actor-a" } }, error: null }); fixture.reads = []; fixture.rows = []; fixture.error = null; host = document.createElement("div"); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); client.clear(); });
it("selects no invitation secrets and binds the canonical kind and active tenant", async () => { await show(); await vi.waitFor(() => expect(host.textContent).toBe("0 invitations")); expect(fixture.reads[0].columns.split(",")).not.toContain("token"); expect(fixture.reads[0].filters).toEqual([["tenant_id", "test-tenant-a"], ["kind", "consumer"]]); expect(fixture.reads[0].signal).toBeInstanceOf(AbortSignal); });
it("does not use a route/foreign tenant as invitation authority", async () => { await show("test-tenant-b"); expect(fixture.getUser).not.toHaveBeenCalled(); expect(fixture.reads).toHaveLength(0); });
it("refuses an SDK subject that differs from the accepted context", async () => { fixture.getUser.mockResolvedValue({ data: { user: { id: "test-actor-b" } }, error: null }); await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); expect(fixture.reads).toHaveLength(0); });
it("keeps read denial distinct from an empty invitation list", async () => { fixture.error = { message: "denied", code: "42501" }; await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); });
it("refuses a truncated aggregate rather than reporting missing invitations", async () => { fixture.rows = Array.from({ length: 1001 }, () => ({})); await show(); await vi.waitFor(() => expect(host.textContent).toBe("failed")); });
it("isolates cached invitation records by authenticated subject as well as tenant", async () => {
  fixture.rows = [{ id: "invite-a" }]; await show(); await vi.waitFor(() => expect(host.textContent).toBe("1 invitations"));
  fixture.context.activeUserId = "test-actor-b"; fixture.getUser.mockResolvedValue({ data: { user: { id: "test-actor-b" } }, error: null }); fixture.rows = [];
  await show(); await vi.waitFor(() => expect(host.textContent).toBe("0 invitations"));
  expect(client.getQueryData(["portal-invitations", "test-actor-b", "test-tenant-a"])).toEqual([]);
});
