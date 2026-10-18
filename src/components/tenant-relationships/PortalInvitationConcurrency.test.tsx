import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerPortalDashboard } from "./OwnerPortalDashboard";
import type { RelationshipPerson, useTenantRelationshipsData } from "./useTenantRelationshipsData";

const fixture = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), readback: vi.fn() }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: "test-actor-a", activeTenantId: "test-tenant-a", accountContextStatus: "ready", accountContextLoading: false }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true }) }));
vi.mock("@/hooks/useBrandKit", () => ({ useBrandKit: () => ({ state: { effective: { product_name: "Test Service", primary_color: "#26362f", logo_url: null } }, isLoading: false, isError: false }) }));
vi.mock("@/hooks/useRailEvents", () => ({ useRailEvents: () => ({ events: [], historyStatus: "ready" }) }));
vi.mock("@/hooks/usePortalConfig", () => ({ usePortalCatalogInput: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("./usePortalInvitations", () => ({ usePortalInvitations: () => ({ data: [], isLoading: false, isError: false, invalidate: fixture.readback }) }));
vi.mock("./PortalConfigurationGate", () => ({ PortalConfigurationGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: () => fixture.getUser() }, rpc: (...args: unknown[]) => fixture.rpc(...args), functions: { invoke: (...args: unknown[]) => fixture.invoke(...args) },
  from: () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: "client-a", status: "active", merged_into_contact_id: null, do_not_contact: false, linked_user_id: null, client_contact_methods: [{ kind: "email", is_primary: true, value: "client@example.test" }] }, error: null }) };
    return chain;
  },
} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const person = { id: "client-a", name: "Test Client", email: "client@example.test", company: "Test Company", contactMethods: [{ kind: "email", value: "client@example.test" }], linkedUserId: null, status: "active", doNotContact: false } as RelationshipPerson;
const data = { people: [person], peopleLoading: false, peopleError: false, portalLoading: false, portalError: false, portalConfig: {}, retryPeople: vi.fn(), retryPortal: vi.fn() } as unknown as ReturnType<typeof useTenantRelationshipsData>;
let host: HTMLDivElement; let root: Root;
const findButton = (name: string, parent: ParentNode = document) => Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === name)!;
const click = async (name: string, parent: ParentNode = document) => { await act(async () => findButton(name, parent).click()); };
const dialog = () => document.querySelector('[role="dialog"]')!;
const operation = "e0953400-0000-4000-8000-000000000001";
const proposal = () => ({ outcome: "approval_required", capability: "client_portal_invitation_send", operation_id: operation, fingerprint: "a".repeat(16), summary: "Invite the saved client at client@example.test.", expires_at: new Date(Date.now() + 600000).toISOString() });
const accepted = { ok: true, outcome: "provider_accepted", operation_id: operation, invitation_id: "e0943400-0000-4000-8000-000000000001", receipt_id: "e0963400-0000-4000-8000-000000000001" };
async function selectClient(selector: string) {
  const select = document.querySelector<HTMLSelectElement>(selector)!;
  await act(async () => { select.value = "client-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
beforeEach(async () => {
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-actor-a" } }, error: null });
  fixture.rpc.mockReset(); fixture.invoke.mockReset().mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) => ({ data: options.body.approved_fingerprint ? accepted : proposal(), error: null })); fixture.readback.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<OwnerPortalDashboard tenantId="test-tenant-a" tenantName="Test Service" data={data} openClient={vi.fn()} openPaige={vi.fn()} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("dashboard invitation action ownership across mounted entry points", () => {
  it("prevents a second review or send from the dialog while the same client's inline review is pending", async () => {
    let finishReview!: (value: unknown) => void;
    fixture.invoke.mockImplementation(() => new Promise((resolve) => { finishReview = resolve; }));
    await click("Client access", host); await selectClient('select[id$="invite-client"]');
    await click("Review invitation", host); expect(fixture.invoke).toHaveBeenCalledTimes(1);
    await click("Invite client", host);
    expect(findButton("Review invitation", dialog()).disabled).toBe(true);
    await click("Review invitation", dialog());
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    await act(async () => finishReview({ data: proposal(), error: null }));
    expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.invoke).toHaveBeenCalledTimes(1); expect(fixture.readback).not.toHaveBeenCalled();
    expect(fixture.invoke.mock.calls[0][1].body.approved_fingerprint).toBeUndefined();
  });

  it.each(["accepted", "lost response"])("keeps the lock through dialog close/reopen and canonical readback after its original control retires (%s)", async (result) => {
    let finishSend!: (value: unknown) => void; let finishReadback!: () => void;
    fixture.readback.mockImplementation(() => new Promise<void>((resolve) => { finishReadback = resolve; }));
    await click("Invite client", host); await selectClient('select[id$="dialog-client"]'); await click("Review invitation", dialog());
    fixture.invoke.mockImplementation(() => new Promise((resolve, reject) => { finishSend = value => result === "accepted" ? resolve(value) : reject(new Error("controlled response loss")); }));
    await click("Approve", dialog());
    expect(fixture.invoke).toHaveBeenCalledTimes(2);
    expect(fixture.invoke.mock.calls[1][1].body).toMatchObject({ operation_id: operation, approved_fingerprint: "a".repeat(16) });
    await click("Close", dialog()); await click("Invite client", host);
    expect(findButton("Review invitation", dialog()).disabled).toBe(true);
    await click("Review invitation", dialog()); expect(fixture.invoke).toHaveBeenCalledTimes(2);
    await act(async () => finishSend({ data: accepted, error: null }));
    expect(fixture.readback).toHaveBeenCalledTimes(1);
    expect(findButton("Review invitation", dialog()).disabled).toBe(true);
    await act(async () => finishReadback());
    expect(findButton("Review invitation", dialog()).disabled).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.invoke).toHaveBeenCalledTimes(2);
  });

  it("retires a closed dialog's late preparation without sending or refreshing an unchanged history", async () => {
    let finishReview!: (value: unknown) => void;
    fixture.invoke.mockImplementation(() => new Promise((resolve) => { finishReview = resolve; }));
    await click("Invite client", host); await selectClient('select[id$="dialog-client"]'); await click("Review invitation", dialog());
    await click("Close", dialog()); await click("Invite client", host);
    expect(findButton("Review invitation", dialog()).disabled).toBe(true);
    await act(async () => finishReview({ data: proposal(), error: null }));
    expect(findButton("Review invitation", dialog()).disabled).toBe(false);
    expect(findButton("Approve", dialog())).toBeUndefined();
    expect(fixture.invoke).toHaveBeenCalledTimes(1); expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.readback).not.toHaveBeenCalled();
  });
});
