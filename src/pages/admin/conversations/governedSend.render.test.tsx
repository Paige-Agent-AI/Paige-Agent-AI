/**
 * INT-328 — a governed send is never presented as a draft awaiting approval.
 *
 * `prepare_comms_email_send` (and the invoice delivery before it) writes the outbound row with
 * `status = 'draft'` BEFORE the provider is called, and an outcome nobody could confirm leaves it
 * there. Before this fix the Conversations inbox drew that row as the gold "Paige drafted — awaiting
 * your approval" card with Approve & send and Edit — on an email that may already have gone out,
 * behind controls the server refuses (403 / guard trigger). This mounts the REAL inbox
 * (`ClientsConversations`, the component Solo mounts at /solo/:account/clients/conversations via
 * TenantRelationshipsClientsWorkspace) against a stubbed message pull and proves what the owner sees.
 *
 * PROOF CLASS: rendered harness (jsdom) — the real component tree with the database stubbed. Not an
 * authenticated runtime drive.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOVERNED_SEND_COLS, governedSendView, isApprovableDraft } from "./governedSend";
import type { MessageRow } from "./inbox-shared";

const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  selects: [] as Array<{ table: string; cols: string }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  // A chainable PostgREST stand-in: every filter returns the builder; awaiting it yields the rows
  // for the table (messages / threads), or an empty list for everything else the inbox reads.
  const builder = (table: string) => {
    const rows = () => table === "messages" ? db.messages
      : table === "threads" ? db.threads
      : table === "channel_connectors" ? [{
        id: "conn-1", channel_type: "email", provider: "resend", display_name: "Jordan",
        from_address: "jordan@northlightadvisory.example", from_name: "Jordan", inbound_address: null,
        status: "active", active: true,
      }]
      : [];
    const result = () => ({ data: rows(), error: null, count: rows().length });
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (ok: (v: unknown) => void) => ok(result());
        if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
        if (key === "select") return (cols: string) => { db.selects.push({ table, cols }); return proxy; };
        return () => proxy;
      },
    });
    return proxy;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string) => Promise.resolve({ data: name === "current_user_tenant_id" ? "tenant-a" : [], error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } } }) },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  };
});
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-a", activeTenant: { id: "tenant-a", account_number: "3855", account_type: "solo" } }),
}));
vi.mock("@/components/ui/paige", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/paige")>()),
  useAgentPresence: () => ({ expandRail: () => {} }),
}));
// The thread's entrance motion would be captured mid-fade in the viewing-aid pages; the reduced-motion
// path renders the same bubbles at rest.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

import ClientsConversations from "@/pages/admin/ClientsConversations";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const KEY = "contact:tenant-a:contact-1";
const NOW = new Date().toISOString();
const client = {
  id: "contact-1", first_name: "Maya", last_name: "Ortiz", entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: null, source: null, tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: null, timezone: null, created_at: NOW, created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null,
  client_contact_methods: [{ kind: "email", value: "maya@ortizlandscaping.example", is_primary: true }],
};
const message = (over: Record<string, unknown>) => ({
  id: "m-1", thread_key: KEY, contact_id: "contact-1", connector_id: "conn-1", channel_type: "email",
  direction: "outbound", status: "draft", sender: { address: "jordan@northlightadvisory.example" },
  recipients: [{ address: "maya@ortizlandscaping.example" }], subject: "Notes from Tuesday's planning call",
  body_text: "Hi Maya,\n\nHere is what we agreed on Tuesday.\n\nJordan", body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null, scheduled_for: null,
  sent_at: null, created_at: NOW, call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: "Maya", last_name: "Ortiz", entity_name: null, client_contact_methods: client.client_contact_methods },
  comms_email_operation: null, comms_email_state: null, sales_invoice_operation: null, sales_invoice_state: null,
  ...over,
});
const thread = {
  id: "t-1", thread_key: KEY, contact_id: "contact-1", snoozed_until: null, archived_at: null, labels: [],
  unread_count: 0, last_message_at: NOW, last_direction: "outbound", clients: client,
};

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { while (mounted.length) await mounted.pop()!(); });

async function mountInbox(path: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><ClientsConversations /></MemoryRouter>);
    await flush();
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await flush(); });
  mounted.push(async () => { await act(async () => { root.unmount(); }); host.remove(); });
  return host;
}

const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());

describe("the inbox reads the governed-send state it needs", () => {
  it("the message pull selects the two binding states (and nothing else from meta)", async () => {
    db.messages = [message({})];
    db.threads = [thread];
    db.selects = [];
    await mountInbox("/solo/3855/clients/conversations");
    const pull = db.selects.find((s) => s.table === "messages" && s.cols.includes("thread_key"));
    expect(pull?.cols).toContain(GOVERNED_SEND_COLS);
    expect(pull?.cols).not.toMatch(/meta(,|\s*$)/);
  });
});

describe.each([
  ["Solo", "/solo/3855/clients/conversations"],
  ["the admin inbox", "/admin/clients/conversations"],
])("%s — a governed email is never an approvable draft", (_label, path) => {
  it("a plain Paige draft still gets the approval card (unchanged)", async () => {
    db.messages = [message({})];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Paige drafted — awaiting your approval");
    expect(buttons(host)).toContain("Approve & send");
  });

  it("an outcome nobody could confirm: no Approve & send, no Edit, and it says don't resend", async () => {
    db.messages = [message({ comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "unknown" })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).not.toContain("Paige drafted — awaiting your approval");
    expect(buttons(host)).not.toContain("Approve & send");
    expect(buttons(host)).not.toContain("Edit");
    expect(host.textContent).toContain("Couldn't confirm");
    expect(host.querySelector('[data-governed-send="unconfirmed"]')?.textContent).toBe("Couldn't confirm this went out — don't resend.");
    // Not counted as a draft anywhere on the page.
    expect(host.textContent).not.toContain("Draft ready");
  });

  it.each(["prepared", "dispatching"])("a send in flight (%s) reads Sending… with no controls", async (state) => {
    db.messages = [message({ comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: state })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).not.toContain("Paige drafted — awaiting your approval");
    expect(buttons(host)).not.toContain("Approve & send");
    expect(buttons(host)).not.toContain("Edit");
    expect(host.textContent).toContain("Sending…");
    expect(host.textContent).not.toContain("Draft ready");
  });

  it("a send the server refused before it left reads Not sent (it used to look like a sent bubble)", async () => {
    db.messages = [message({ status: "blocked", comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "refused" })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(buttons(host)).not.toContain("Approve & send");
    expect(host.textContent).toContain("Not sent");
  });

  it("an invoice delivery in flight is treated the same way", async () => {
    db.messages = [message({ sales_invoice_operation: "1b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", sales_invoice_state: "dispatching" })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(buttons(host)).not.toContain("Approve & send");
    expect(host.textContent).toContain("Sending…");
  });
});

describe("the one rule, as the draft count and the views read it", () => {
  const row = (over: Record<string, unknown>) => message(over) as unknown as MessageRow;
  it("only an unbound outbound draft is approvable", () => {
    expect(isApprovableDraft(row({}))).toBe(true);
    expect(isApprovableDraft(row({ comms_email_state: "unknown", comms_email_operation: "x" }))).toBe(false);
    expect(isApprovableDraft(row({ comms_email_state: "prepared", comms_email_operation: "x" }))).toBe(false);
    expect(isApprovableDraft(row({ sales_invoice_state: "prepared", sales_invoice_operation: "x" }))).toBe(false);
    // A binding whose state could not be read is still never approvable.
    expect(isApprovableDraft(row({ comms_email_operation: "x" }))).toBe(false);
    expect(isApprovableDraft(row({ status: "sent" }))).toBe(false);
  });
  it("maps every binding state to what the owner is told", () => {
    expect(governedSendView(row({ comms_email_operation: "x", comms_email_state: "prepared" }))).toBe("sending");
    expect(governedSendView(row({ comms_email_operation: "x", comms_email_state: "dispatching" }))).toBe("sending");
    expect(governedSendView(row({ comms_email_operation: "x", comms_email_state: "unknown" }))).toBe("unconfirmed");
    expect(governedSendView(row({ comms_email_operation: "x", comms_email_state: "provider_accepted", status: "sent" }))).toBe("settled");
    expect(governedSendView(row({}))).toBeNull();
  });
});

// ── Viewing aid (§00: the owner SEES the state) — needs a build for the compiled tokens. ─────────
function compiledCss(): string {
  const files = readdirSync("dist/assets").filter((f) => f.endsWith(".css"));
  return ["main-", "SoloEntry-"].map((p) => files.find((f) => f.startsWith(p))).filter(Boolean)
    .map((f) => readFileSync(`dist/assets/${f}`, "utf8")).join("\n");
}

describe("Conversations governed-send render harness", () => {
  it.skipIf(!existsSync("dist/assets"))("writes the light and dark pages", async () => {
    const scenes: Array<{ label: string; note: string; row: Record<string, unknown> }> = [
      { label: "A draft Paige wrote — unchanged", note: "Still the one card that asks for approval, with Approve & send.", row: {} },
      { label: "An approved email on its way", note: "Approved in chat and handed to the email service. No approve, no edit — it is already going.", row: { comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "dispatching" } },
      { label: "An email nobody could confirm", note: "The send was attempted and the outcome never came back. It may have gone out, so it says not to resend.", row: { comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "unknown" } },
    ];
    const captured: string[] = [];
    for (const scene of scenes) {
      db.messages = [
        message({ id: "in-1", direction: "inbound", status: "received", sender: { address: "maya@ortizlandscaping.example", display_name: "Maya Ortiz" }, subject: "Tuesday", body_text: "Could you send over what we agreed on Tuesday?", created_at: new Date(Date.now() - 3600_000).toISOString() }),
        message(scene.row),
      ];
      db.threads = [thread];
      const host = await mountInbox("/solo/3855/clients/conversations");
      const pane = Array.from(host.querySelectorAll<HTMLElement>(".overflow-y-auto")).find((el) => el.textContent?.includes("Notes from Tuesday"));
      expect(pane).toBeTruthy();
      captured.push(`<section class="scene" data-scene="${scene.label}"><h2>${scene.label}</h2><p>${scene.note}</p><div class="frame">${pane!.innerHTML}</div></section>`);
      await mounted.pop()!();
    }
    const page = (theme: "light" | "dark") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conversations — governed send — ${theme}</title>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />
<style>${compiledCss()}</style>
<style>
  html, body { margin: 0; }
  body { background: var(--pg-env); color: var(--pg-ink); font-family: var(--pg-font-ui); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; display: grid; gap: 28px; }
  .scene h2 { font-family: var(--pg-font-display); font-size: 16px; letter-spacing: -0.01em; margin: 0 0 3px; }
  .scene > p { color: var(--pg-muted); font-size: 13px; line-height: 1.55; margin: 0 0 10px; max-width: 68ch; }
  .frame { background: hsl(var(--background)); border: 1px solid var(--pg-line); border-radius: 14px; padding: 16px; display: grid; gap: 12px; }
  @media (max-width: 480px) { .wrap { padding: 20px 12px 40px; } .frame { padding: 10px; } }
</style></head>
<body data-pg="${theme}"><div class="wrap">${captured.join("\n")}</div></body></html>`;
    const dir = "scripts/live-drive/artifacts/comms-email-send";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/conversations-governed-send.light.html`, page("light"), "utf8");
    writeFileSync(`${dir}/conversations-governed-send.dark.html`, page("dark"), "utf8");
  }, 60_000);
});
