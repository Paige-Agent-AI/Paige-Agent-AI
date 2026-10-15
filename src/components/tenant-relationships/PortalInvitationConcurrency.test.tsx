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
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: [] } }) }));
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
async function selectClient(selector: string) {
  const select = document.querySelector<HTMLSelectElement>(selector)!;
  await act(async () => { select.value = "client-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
beforeEach(async () => {
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-actor-a" } }, error: null });
  fixture.rpc.mockReset(); fixture.invoke.mockReset().mockResolvedValue({ data: { ok: true, emailed: true }, error: null }); fixture.readback.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<OwnerPortalDashboard tenantId="test-tenant-a" tenantName="Test Service" data={data} openClient={vi.fn()} openPaige={vi.fn()} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("dashboard invitation action ownership across mounted entry points", () => {
  it("prevents a second mint/send from the dialog while the same client's inline action is pending", async () => {
    let finishMint!: (value: unknown) => void;
    fixture.rpc.mockImplementation(() => new Promise((resolve) => { finishMint = resolve; }));
    await click("Client access", host); await selectClient('select[id$="invite-client"]');
    await click("Send invitation email", host); expect(fixture.rpc).toHaveBeenCalledTimes(1);
    await click("Invite client", host);
    expect(findButton("Checking invitation…", dialog()).disabled).toBe(true);
    await click("Checking invitation…", dialog());
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    await act(async () => finishMint({ data: { token: "synthetic-token" }, error: null }));
    expect(fixture.rpc).toHaveBeenCalledTimes(1); expect(fixture.invoke).toHaveBeenCalledTimes(1); expect(fixture.readback).toHaveBeenCalledTimes(1);
  });

  it("keeps the lock through dialog close/reopen and canonical readback after its original control retires", async () => {
    let finishMint!: (value: unknown) => void; let finishReadback!: () => void;
    fixture.rpc.mockImplementation(() => new Promise((resolve) => { finishMint = resolve; }));
    fixture.readback.mockImplementation(() => new Promise<void>((resolve) => { finishReadback = resolve; }));
    await click("Invite client", host); await selectClient('select[id$="dialog-client"]'); await click("Send invitation email", dialog());
    await click("Close", dialog()); await click("Invite client", host);
    expect(findButton("Checking invitation…", dialog()).disabled).toBe(true);
    await click("Checking invitation…", dialog()); expect(fixture.rpc).toHaveBeenCalledTimes(1);
    await act(async () => finishMint({ data: { token: "synthetic-token" }, error: null }));
    expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.readback).toHaveBeenCalledTimes(1);
    expect(findButton("Checking invitation…", dialog()).disabled).toBe(true);
    await act(async () => finishReadback());
    expect(findButton("Send invitation email", dialog()).disabled).toBe(false);
  });
});
