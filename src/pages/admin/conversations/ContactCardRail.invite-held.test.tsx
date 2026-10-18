import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContact } from "./inbox-shared";

// E09 Slice 6 (M2a, §37): "Send portal invite" on the Conversations card reads the legacy path's 409
// INVITATION_POLICY_HELD truthfully: no "link ready to share", no hand-off. Synthetic contact only (§63).
const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), plain: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => t.plain(...a), { success: t.success, error: t.error }) }));
const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const proxy: unknown = new Proxy({}, { get: (_t, key) => key === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => proxy });
  return { supabase: { rpc: (name: string, args: unknown) => rpc(name, args), from: () => proxy, functions: { invoke: (n: string, a: unknown) => invoke(n, a) } } };
});
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: (f: string) => f === "customer_portal_invite" }) }));
vi.mock("@/lib/customFields", () => ({ listCustomFieldDefinitions: async () => [], listClientCustomFieldValues: async () => [] }));
vi.mock("@/components/admin/voice/CallButton", () => ({ CallButton: () => null }));
vi.mock("@/components/admin/contacts/ContactPortalPanel", () => ({ ContactPortalPanel: () => null }));
vi.mock("@/components/admin/contacts/ContactBillingPanel", () => ({ ContactBillingPanel: () => null }));
vi.mock("@/components/admin/contacts/ContactAutomationHistory", () => ({ ContactAutomationHistory: () => null }));
vi.mock("@/components/admin/contacts/ClientOnboardingStatusPanel", () => ({ ClientOnboardingStatusPanel: () => null }));
vi.mock("@/components/admin/contacts/TagPicker", () => ({ TagPicker: () => null }));
vi.mock("@/components/admin/contacts/ContactDealsSection", () => ({ ContactDealsSection: () => null }));
vi.mock("@/components/planning/QuickAddDialog", () => ({ QuickAddDialog: () => null }));
vi.mock("./AgentsLog", () => ({ AgentsLog: () => null }));
const { ContactCardRail } = await import("./ContactCardRail");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const contact: ClientContact = {
  id: "e0960000-0000-4000-8000-00000000d001", first_name: "Jordan", last_name: "Rivera", entity_name: null,
  email: "jordan.rivera@example.test", phone: "+12025550101", status: "active", timezone: null, created_at: "2026-09-01T00:00:00Z",
  created_by: null, created_by_channel_type: null, lifecycle_stage: null, entity_type: null, title: null, source: null, tags: [],
  last_contacted_at: null, assigned_coach_user_id: null, linked_user_id: null, dnd_active: false, dnd_reason: null, dnd_until: null,
};
let root: Root, host: HTMLDivElement;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function sendFromActions() {
  act(() => root.render(<MemoryRouter><ContactCardRail contact={contact} channel="email" toAddress={contact.email!} recentMessages={[]} labels={[]}
    suppressions={[]} userId={null} tenantId="e0960000-0000-4000-8000-00000000b001" onClose={() => undefined} onChanged={() => undefined} /></MemoryRouter>));
  await flush();
  const tab = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => el.textContent === "Actions")!;
  act(() => { tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); tab.focus(); }); await flush();
  const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Send portal invite"))!;
  act(() => button.click()); await flush();
}

beforeEach(() => {
  rpc.mockReset(); invoke.mockReset(); t.success.mockReset(); t.error.mockReset(); t.plain.mockReset();
  rpc.mockImplementation(async (name: string) => name === "create_tenant_invite_token" ? { data: [{ token: "synthetic-token" }], error: null } : { data: [], error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Conversations card — a held portal invitation", () => {
  it("names the client, says Paige didn't send it, and offers no link to share", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code",
      context: { status: 409, json: async () => ({ ok: false, emailed: false, status: "held", code: "INVITATION_POLICY_HELD", hold: "contact" }) } } });
    await sendFromActions();
    expect(invoke).toHaveBeenCalledWith("send-portal-invite", { body: { token: "synthetic-token", email: contact.email } });
    expect(t.error).toHaveBeenCalledWith("Jordan Rivera has email turned off or on hold, so Paige didn't send the invitation.");
    expect(t.success).not.toHaveBeenCalled();
    expect(JSON.stringify([t.error.mock.calls, t.plain.mock.calls])).not.toMatch(/ready to share|send it to|copied/i);
  });

  it("an emailed invitation still reads as emailed", async () => {
    invoke.mockResolvedValue({ data: { ok: true, emailed: true }, error: null });
    await sendFromActions();
    expect(t.success).toHaveBeenCalledWith(`Portal invite emailed to ${contact.email}.`);
  });
});
