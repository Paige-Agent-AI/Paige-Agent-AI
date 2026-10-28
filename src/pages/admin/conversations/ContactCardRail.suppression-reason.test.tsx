import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientContact, Suppression } from "./inbox-shared";

// EXP03 (20271120120003, review M1): the rail says WHY PAIGE won't send, from each row's reason. A bounce is about
// the ADDRESS ("This email address bounced. Check it, or use another address."), a spam report is the person
// marking it as spam, an opt-out keeps "Opted out of …". An address-keyed bounce is not the business's pause, so
// the Do-not-contact switch does not claim it (the switch's writer lifts only rows keyed on the contact).
// Synthetic contact only (§63).
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

const signal = () => host.querySelector<HTMLElement>("[data-suppression-signal]")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("Conversations rail — the reason, in words", () => {
  it("an address bounce says the address bounced, never 'Opted out'", async () => {
    await mount([{ channel: "email", reason: "bounce_hard", keyed: "address" }]);
    expect(signal()).toContain("This email address bounced. Check it, or use another address.");
    expect(signal()).not.toMatch(/opted out/i);
  });
  it("an address bounce is not the business's pause: the Email switch stays off and says why", async () => {
    await mount([{ channel: "email", reason: "bounce_hard", keyed: "address" }]);
    expect(sw("Email").getAttribute("data-state")).toBe("unchecked");
    expect(host.textContent).toContain("This email address bounced. Check it, or use another address.");
  });
  it("a contact-keyed bounce says what lifts it: the Email switch in this DND tab (on, liftable)", async () => {
    await mount([{ channel: "email", reason: "bounce_hard", keyed: "contact" }]);
    expect(signal()).toContain("This contact's email bounced. Fix their address, then an owner or admin turns off Email in the DND tab.");
    expect(signal()).not.toContain("Check it, or use another address.");
    expect(sw("Email").getAttribute("data-state")).toBe("checked");
    expect(sw("Email").disabled).toBe(false);
    expect(host.textContent).toContain("Bounced. Fix their address, then turn this off.");
  });
  it("a spam report says they marked it as spam", async () => {
    await mount([{ channel: "email", reason: "complaint" }]);
    expect(signal()).toContain("Marked your email as spam");
    expect(signal()).not.toMatch(/opted out/i);
  });
  it("an opt-out keeps its words", async () => {
    await mount([{ channel: "email", reason: "unsubscribe_link" }]);
    expect(signal()).toContain("Opted out of Email — Paige won't send on this.");
  });
  it("each reason gets its own line; opt-outs are grouped as before", async () => {
    await mount([{ channel: "sms", reason: "user_stop" }, { channel: "email", reason: "bounce_hard", keyed: "address" }]);
    expect(signal()).toContain("Opted out of SMS — Paige won't send on this.");
    expect(signal()).toContain("This email address bounced. Check it, or use another address.");
  });
});
