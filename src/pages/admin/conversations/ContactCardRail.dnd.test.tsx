import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContact, Suppression } from "./inbox-shared";

// E09 Slice 6 (D3, reviewer B1): the Conversations DND switches are the one staff pause/lift. A channel the
// CONTACT turned off can't be lifted here, a refusal from the writer is shown in words, and an unchanged
// answer is never toasted as a change. Synthetic contact only (§63).
const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), plain: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => t.plain(...a), { success: t.success, error: t.error }) }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const proxy: unknown = new Proxy({}, { get: (_t, key) => key === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => proxy });
  return { supabase: { rpc: (name: string, args: unknown) => rpc(name, args), from: () => proxy } };
});
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => false }) }));
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
const onChanged = vi.fn();
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount(suppressions: Suppression[]) {
  act(() => root.render(<MemoryRouter><ContactCardRail contact={contact} channel="email" toAddress={contact.email!} recentMessages={[]} labels={[]}
    suppressions={suppressions} userId="u1" tenantId="e0960000-0000-4000-8000-00000000b001" onClose={() => undefined} onChanged={onChanged} /></MemoryRouter>));
  await flush();
  const tab = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => el.textContent === "DND")!;
  act(() => { tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); tab.focus(); }); await flush();
}
const sw = (label: string) => host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="Do not contact on ${label}"]`)!;

beforeEach(() => {
  rpc.mockReset(); onChanged.mockReset(); t.success.mockReset(); t.error.mockReset(); t.plain.mockReset();
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Conversations DND — the one staff pause", () => {
  it.each(["customer_request", "user_stop", "unsubscribe_link"])("a %s row is held by the contact: switch locked on, with the reason shown", async reason => {
    await mount([{ channel: "email", reason }]);
    expect(sw("Email").getAttribute("data-state")).toBe("checked");
    expect(sw("Email").disabled).toBe(true);
    expect(host.textContent).toContain("Turned off by the contact. Only they can turn it back on.");
    expect(sw("SMS").disabled).toBe(false);
  });

  it("a spam report is the contact's own act: locked, and said in those words (integrator default (owner may overrule))", async () => {
    await mount([{ channel: "email", reason: "complaint" }]);
    expect(sw("Email").disabled).toBe(true);
    expect(host.textContent).toContain("They reported email as spam. Only they can turn it back on.");
    expect(host.textContent).not.toContain("Turned off by the contact.");
  });

  it("the business's own pause can still be lifted from here", async () => {
    await mount([{ channel: "email", reason: "manual" }]);
    expect(sw("Email").disabled).toBe(false);
    rpc.mockImplementation(async () => ({ data: { changed: true }, error: null }));
    act(() => sw("Email").click()); await flush();
    expect(rpc).toHaveBeenCalledWith("set_contact_channel_suppression", { _contact_id: contact.id, _channel: "email", _suppressed: false, _reason: "manual" });
    expect(t.success).toHaveBeenCalledWith("Email re-enabled.");
  });

  it("the writer's held refusal is shown in words and the switch goes back", async () => {
    await mount([{ channel: "email", reason: "manual" }]);
    rpc.mockImplementation(async () => ({ data: null, error: { message: "SUPPRESSION_HELD_BY_CONTACT: Email was turned off by the contact" } }));
    act(() => sw("Email").click()); await flush();
    expect(t.error).toHaveBeenCalledWith("Email was turned off by the contact. Only they can turn it back on.");
    expect(sw("Email").getAttribute("data-state")).toBe("checked");
    expect(t.success).not.toHaveBeenCalled();
  });

  it("an unchanged answer is never toasted as a change", async () => {
    await mount([]);
    rpc.mockImplementation(async () => ({ data: { changed: false }, error: null }));
    act(() => sw("SMS").click()); await flush();
    expect(t.success).not.toHaveBeenCalled();
    expect(t.plain).toHaveBeenCalledWith("SMS was already paused for this contact.");
  });
});
