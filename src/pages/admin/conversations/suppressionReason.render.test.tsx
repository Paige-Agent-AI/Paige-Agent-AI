/**
 * EXP03 (20271120120003, review M1) — the Conversations inbox says WHY PAIGE won't send, from the row's reason.
 * A governed email that bounces now writes a `bounce_hard` row keyed on the normalised ADDRESS (no contact); a
 * spam report writes a `complaint` row on the contact. The inbox read every row for the contact and called each
 * one "opted out" — so a bounce told the owner the person had opted out. Now: a bounce says the address bounced
 * (check it, or use another), a complaint says they marked it as spam, an opt-out keeps its words; and the
 * business's address-keyed rows for the contact's CURRENT main email are read too (a corrected address is not).
 *
 * Mounts the REAL inbox (ClientsConversations) with the database stubbed; the paige_suppressions stub honours
 * the filters the inbox sends (contact_id / tenant_id / channel / address_normalized / contact_id IS NULL).
 * PROOF CLASS: rendered harness (jsdom). Not an authenticated runtime drive. Synthetic data only (§63).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_TENANT = "7a2b3c4d-5e6f-4a71-8b9c-0d1e2f3a4b5c";
const CONTACT = "0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5";
const CONN = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";

type Row = { tenant_id: string; contact_id: string | null; address_normalized: string | null; channel: string; reason: string };
const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  connectors: [] as Array<Record<string, unknown>>,
  suppressions: [] as Array<{ tenant_id: string; contact_id: string | null; address_normalized: string | null; channel: string; reason: string }>,
  suppressionQueries: [] as Array<Array<[string, string, unknown]>>,
  tenant: "",
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    if (table === "paige_suppressions") db.suppressionQueries.push(filters);
    const rows = () => {
      if (table === "paige_suppressions") {
        return db.suppressions
          .filter((r) => filters.every(([op, col, v]) => op === "is" ? (r as Record<string, unknown>)[col] === v : (r as Record<string, unknown>)[col] === v))
          .map(({ channel, reason }) => ({ channel, reason }));
      }
      return table === "messages" ? db.messages : table === "threads" ? db.threads : table === "channel_connectors" ? db.connectors : [];
    };
    const result = () => ({ data: rows(), error: null, count: rows().length });
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (ok: (v: unknown) => void) => ok(result());
        if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
        if (key === "eq" || key === "is") return (col: string, v: unknown) => { filters.push([key, col, v]); return proxy; };
        return () => proxy;
      },
    });
    return proxy;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string) => Promise.resolve({ data: name === "current_user_tenant_id" ? db.tenant : [], error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), remove: () => Promise.resolve({ data: null, error: null }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  };
});
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: db.tenant, activeTenant: { id: db.tenant, account_number: "3855", account_type: "solo" }, accountContextStatus: "ready" }),
}));
vi.mock("@/components/ui/paige", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/paige")>()),
  useAgentPresence: () => ({ expandRail: () => {} }),
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));

import ClientsConversations from "@/pages/admin/ClientsConversations";
import { toast } from "sonner";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const KEY = `contact:${TENANT}:${CONTACT}`;
const NOW = new Date().toISOString();
const MAIN = "Maya+news@OrtizLandscaping.example";   // the card's main email; normalised: maya@ortizlandscaping.example
const NORM = "maya@ortizlandscaping.example";
const client = (email: string) => ({
  id: CONTACT, first_name: "Maya", last_name: "Ortiz", entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: null, source: null, tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: null, timezone: null, created_at: NOW, created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null, email,
  client_contact_methods: [{ kind: "email", value: email, is_primary: true }],
});
const message = () => ({
  id: "m-1", thread_key: KEY, contact_id: CONTACT, connector_id: CONN, channel_type: "email",
  direction: "inbound", status: "received", sender: { address: MAIN },
  recipients: [{ address: "jordan@northlightadvisory.example" }], subject: "Tuesday",
  body_text: "Could you send over what we agreed?", body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null, scheduled_for: null,
  sent_at: NOW, created_at: NOW, call_duration_seconds: null, recording_url: null, transcript: null,
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
  clients: { first_name: "Maya", last_name: "Ortiz", entity_name: null, client_contact_methods: [{ kind: "email", value: MAIN, is_primary: true }] },
});
const thread = (email = MAIN) => ({ id: "t-1", thread_key: KEY, contact_id: CONTACT, snoozed_until: null, archived_at: null, labels: [], unread_count: 0, last_message_at: NOW, last_direction: "inbound", clients: client(email) });
const bounceAt = (address: string, tenant = TENANT): Row => ({ tenant_id: tenant, contact_id: null, address_normalized: address, channel: "email", reason: "bounce_hard" });
const onContact = (reason: string, channel = "email"): Row => ({ tenant_id: TENANT, contact_id: CONTACT, address_normalized: null, channel, reason });

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await flush(); }); };
const mounted: Array<() => Promise<void>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  db.messages = [message()]; db.threads = [thread()]; db.suppressions = []; db.suppressionQueries = [];
  db.connectors = [{ id: CONN, channel_type: "email", provider: "sendgrid", display_name: "Northlight Advisory", from_address: "jordan@northlightadvisory.example", from_name: "Northlight Advisory", inbound_address: null, status: "active", active: true }];
  db.tenant = TENANT;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});
afterEach(async () => { while (mounted.length) await mounted.pop()!(); });

async function mount(path = "/solo/3855/clients/conversations") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  await act(async () => { r.render(<MemoryRouter initialEntries={[path]}><ClientsConversations /></MemoryRouter>); await flush(); });
  await settle();
  mounted.push(async () => { await act(async () => { r.unmount(); }); host.remove(); });
  return host;
}
const sendButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-composer-send]");
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
}
async function write(host: HTMLElement) {
  await type(host.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!, "Thursday");
  await type(host.querySelector<HTMLTextAreaElement>('[data-composer-writing-surface="true"] textarea')!, "Following up on Thursday.");
}

describe("the inbox says why PAIGE won't send — from the reason, never 'opted out' for a bounce", () => {
  it("reads this business's address-keyed rows for the contact's CURRENT main email (normalised), not only the contact's", async () => {
    db.suppressions = [bounceAt(NORM)];
    await mount();
    const byAddress = db.suppressionQueries.find((q) => q.some(([op, col]) => op === "is" && col === "contact_id"));
    expect(byAddress).toEqual(expect.arrayContaining([
      ["eq", "tenant_id", TENANT], ["eq", "channel", "email"], ["is", "contact_id", null], ["eq", "address_normalized", NORM],
    ]));
  });

  it("an address bounce: the composer says the address bounced and holds Send (Solo), never 'opted out'", async () => {
    db.suppressions = [bounceAt(NORM)];
    const host = await mount();
    await write(host);
    expect(host.textContent).toContain("This email address bounced. Check it, or use another address.");
    expect(host.textContent).not.toMatch(/opted out/i);
    expect(sendButton(host)?.getAttribute("aria-disabled") === "true" || sendButton(host)?.disabled).toBe(true);
  });

  it("an address bounce on the admin inbox: Send explains the bounce in words, never 'opted out'", async () => {
    db.suppressions = [bounceAt(NORM)];
    const host = await mount("/admin/clients-hub/conversations");
    await write(host);
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(toast.error).toHaveBeenCalledWith("This email address bounced. Check it, or use another address.");
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/opted out/));
  });

  it("a corrected main email is not held by the old address's bounce", async () => {
    db.suppressions = [bounceAt(NORM)];
    db.threads = [thread("maya.ortiz@ortizlandscaping.example")];
    const host = await mount();
    await write(host);
    expect(host.textContent).not.toContain("bounced");
    expect(sendButton(host)?.disabled).toBe(false);
  });

  it("another business's bounce at the same address is never read", async () => {
    db.suppressions = [bounceAt(NORM, OTHER_TENANT)];
    const host = await mount();
    await write(host);
    expect(host.textContent).not.toContain("bounced");
    expect(sendButton(host)?.disabled).toBe(false);
  });

  it("a spam report says they marked it as spam", async () => {
    db.suppressions = [onContact("complaint")];
    const host = await mount("/admin/clients-hub/conversations");
    await write(host);
    expect(host.textContent).toContain("They marked your email as spam — Paige won't send email.");
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(toast.error).toHaveBeenCalledWith("They marked your email as spam — Paige won't send email.");
  });

  // Review M-B: a bounce kept on the CONTACT (the campaign applier and the Resend receipt path write those) is not
  // lifted by changing the address, so "check it, or use another address" would be untrue. Say what lifts it.
  it("a contact-keyed bounce on the admin inbox names what lifts it (the card's DND tab), not 'use another address'", async () => {
    db.suppressions = [onContact("bounce_hard")];
    const host = await mount("/admin/clients-hub/conversations");
    await write(host);
    expect(host.textContent).toContain("This contact's email bounced. Fix their address, then an owner or admin turns off Email in the DND tab of their card.");
    expect(host.textContent).not.toContain("Check it, or use another address.");
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(toast.error).toHaveBeenCalledWith("This contact's email bounced. Fix their address, then an owner or admin turns off Email in the DND tab of their card.");
  });

  it("a contact-keyed bounce in Solo (no DND tab there) says changing the address won't lift it", async () => {
    db.suppressions = [onContact("bounce_hard")];
    const host = await mount();
    await write(host);
    expect(host.textContent).toContain("This contact's email bounced. Changing their address won't lift this hold.");
    expect(host.textContent).not.toContain("Check it, or use another address.");
    expect(sendButton(host)?.getAttribute("aria-disabled") === "true" || sendButton(host)?.disabled).toBe(true);
  });

  it("an opt-out keeps its words", async () => {
    db.suppressions = [onContact("unsubscribe_link")];
    const host = await mount("/admin/clients-hub/conversations");
    await write(host);
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(toast.error).toHaveBeenCalledWith("This contact opted out of Email — Paige won't send.");
  });
});
