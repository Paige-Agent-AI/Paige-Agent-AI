import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalInvitationManager } from "./PortalInvitationManager";
import type { RelationshipPerson } from "./useTenantRelationshipsData";
import type { PortalInvitation } from "./portalDashboardModel";
const fixture = vi.hoisted(() => ({
  context: { activeUserId: "test-actor-a", activeTenantId: "test-tenant-a", accountContextStatus: "ready", accountContextLoading: false },
  allowed: true, getUser: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), readback: vi.fn(),
  requests: [] as Array<{ table: string; filters: unknown[][]; update?: unknown }>,
  contact: { data: { id: "client-a", status: "active", merged_into_contact_id: null as string | null, do_not_contact: false, linked_user_id: null as string | null }, error: null },
  method: { data: { value: "client@example.test" }, error: null }, cancelRows: [{ id: "invite-a" }],
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => fixture.allowed }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: () => fixture.getUser() }, rpc: (...args: unknown[]) => fixture.rpc(...args), functions: { invoke: (...args: unknown[]) => fixture.invoke(...args) },
  from: (table: string) => {
    const record = { table, filters: [] as unknown[][], update: undefined as unknown }; fixture.requests.push(record);
    const chain = { select: () => chain, update: (patch: unknown) => { record.update = patch; return chain; }, eq: (...args: unknown[]) => { record.filters.push(args); return chain; }, is: (...args: unknown[]) => { record.filters.push(args); return chain; }, gt: (...args: unknown[]) => { record.filters.push(args); return chain; }, maybeSingle: async () => table === "clients" ? { ...fixture.contact, data: { ...fixture.contact.data, client_contact_methods: [{ kind: "email", is_primary: true, value: fixture.method.data.value }] } } : table === "client_contact_methods" ? fixture.method : { data: { token: "synthetic-invite-token" }, error: null }, then: (done: (value: unknown) => unknown) => Promise.resolve({ data: fixture.cancelRows, error: null }).then(done) }; return chain;
  },
} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const person = { id: "client-a", name: "Test Client", email: "client@example.test", linkedUserId: null, status: "active", doNotContact: false } as RelationshipPerson;
const pending: PortalInvitation = { id: "invite-a", contact_id: "client-a", email: person.email, created_at: "2026-10-01T12:00:00Z", expires_at: "2099-10-30T12:00:00Z", revoked_at: null, last_used_at: null };
let host: HTMLDivElement; let root: Root;
const show = async (contact = person, latest?: PortalInvitation) => { await act(async () => root.render(<PortalInvitationManager tenantId="test-tenant-a" person={contact} latest={latest} onReadback={fixture.readback} />)); };
const click = async (name: string) => { const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent === name)!; await act(async () => button.click()); };
beforeEach(() => {
  fixture.context = { activeUserId: "test-actor-a", activeTenantId: "test-tenant-a", accountContextStatus: "ready", accountContextLoading: false }; fixture.allowed = true; fixture.requests = [];
  fixture.contact = { data: { id: "client-a", status: "active", merged_into_contact_id: null, do_not_contact: false, linked_user_id: null }, error: null }; fixture.method = { data: { value: "client@example.test" }, error: null }; fixture.cancelRows = [{ id: "invite-a" }];
  fixture.getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-actor-a" } }, error: null }); fixture.rpc.mockReset().mockResolvedValue({ data: { token: "synthetic-invite-token" }, error: null }); fixture.invoke.mockReset().mockResolvedValue({ data: { ok: true, emailed: true }, error: null }); fixture.readback.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe("explicit canonical invitation actions", () => {
  it("mints a single-use contact/tenant/recipient-bound invitation and reports provider acceptance only", async () => {
    await show(); await click("Send invitation email");
    expect(fixture.rpc).toHaveBeenCalledWith("create_tenant_invite_token", expect.objectContaining({ _tenant_id: "test-tenant-a", _contact_id: "client-a", _email: "client@example.test", _max_uses: 1, _kind: "consumer" }));
    expect(fixture.invoke).toHaveBeenCalledWith("send-portal-invite", { body: { token: "synthetic-invite-token", email: "client@example.test" } });
    expect(host.textContent).toContain("accepted the invitation for sending"); expect(host.textContent).not.toContain("synthetic-invite-token"); expect(fixture.readback).toHaveBeenCalledOnce();
    for (const request of fixture.requests) expect(request.filters).toContainEqual(["tenant_id", "test-tenant-a"]);
  });
  it("reuses a pending exact-contact token rather than minting another on resend", async () => {
    await show(person, pending); await click("Resend invitation email"); expect(fixture.rpc).not.toHaveBeenCalled();
    const request = fixture.requests.find((entry) => entry.table === "tenant_invite_tokens")!;
    expect(request.filters).toEqual(expect.arrayContaining([["id", "invite-a"], ["contact_id", "client-a"], ["kind", "consumer"], ["revoked_at", null], ["last_used_at", null]]));
  });
  it("never reports a blocked or failed provider call as sent", async () => {
    fixture.invoke.mockResolvedValue({ data: { ok: false, emailed: false, status: "blocked" }, error: null });
    await show(); await click("Send invitation email"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Email sending was not confirmed"); expect(host.textContent).not.toContain("accepted the invitation for sending");
  });
  it.each(["do_not_contact", "merged_into_contact_id", "linked_user_id", "status"])("rechecks changed canonical %s before mint/send", async (field) => {
    Object.assign(fixture.contact.data, { [field]: field === "do_not_contact" ? true : field === "status" ? "inactive" : "changed" });
    await show(); await click("Send invitation email"); expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.invoke).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("refuses an email changed after the roster loaded", async () => { fixture.method.data.value = "changed@example.test"; await show(); await click("Send invitation email"); expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.invoke).not.toHaveBeenCalled(); });
  it("refuses a mismatched authenticated subject", async () => { fixture.getUser.mockResolvedValue({ data: { user: { id: "test-actor-b" } }, error: null }); await show(); await click("Send invitation email"); expect(fixture.requests).toHaveLength(0); expect(fixture.invoke).not.toHaveBeenCalled(); });
  it("cancels only the exact pending consumer invitation and requires a matching readback", async () => {
    await show(person, pending); await click("Cancel pending invitation"); const request = fixture.requests[0]; expect(request.filters).toEqual(expect.arrayContaining([["tenant_id", "test-tenant-a"], ["contact_id", "client-a"], ["id", "invite-a"], ["last_used_at", null]])); expect(request.update).toBeTruthy(); expect(fixture.invoke).not.toHaveBeenCalled(); expect(host.textContent).toContain("Invitation canceled.");
  });
  it("does not claim cancellation if acceptance won the race", async () => { fixture.cancelRows = []; await show(person, pending); await click("Cancel pending invitation"); expect(host.textContent).toContain("The invitation changed"); expect(host.textContent).not.toContain("Invitation canceled."); });
  it("keeps a readback failure recoverable after an accepted send", async () => { fixture.readback.mockRejectedValue(new Error("offline")); await show(); await click("Send invitation email"); expect(host.textContent).toContain("status could not be reloaded"); expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false); });
  it("starts no operation in a different or unresolved workspace", async () => { fixture.context.activeTenantId = "test-tenant-b"; await show(); await click("Send invitation email"); expect(fixture.getUser).not.toHaveBeenCalled(); expect(fixture.rpc).not.toHaveBeenCalled(); });
  it("retires a pending authentication check on unmount", async () => {
    let finish!: (value: unknown) => void; fixture.getUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await show(); await click("Send invitation email"); act(() => root.unmount());
    await act(async () => finish({ data: { user: { id: "test-actor-a" } }, error: null })); expect(fixture.requests).toHaveLength(0); expect(fixture.invoke).not.toHaveBeenCalled();
    root = createRoot(host);
  });
});
