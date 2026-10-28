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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOVERNED_SEND_COLS, SCHEDULED_RELEASE_GRACE_MS, SENDING_WINDOW_MS, cancelTooLateLine, governedEmailReceiptLabel, governedNotSentLine, governedSendView, isApprovableDraft, isScheduledMessage } from "./governedSend";
import type { MessageRow } from "./inbox-shared";

const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  selects: [] as Array<{ table: string; cols: string }>,
  cancellations: [] as string[],
  cancel: async (): Promise<{ data: unknown; error: unknown }> => ({ data: true, error: null }),
  contact: null as Record<string, unknown> | null,
  invokes: [] as string[],
  draft: null as null | (() => Promise<{ data: unknown; error: unknown }>),
  /** send-message's answer (default: the undo-window queue). */
  sendAnswer: null as null | { data: unknown; error: unknown },
  /** Bodies handed to the governed email door, and its answer (default: cancelled). */
  doorBodies: [] as Array<Record<string, unknown>>,
  doorAnswer: null as null | { data: unknown; error: unknown },
  /** A door answer that has not arrived yet (the Cancel is in flight). */
  doorPending: null as null | Promise<{ data: unknown; error: unknown }>,
  /** An answer built from the request (the reply check echoes its own operation id). */
  doorFn: null as null | ((body: Record<string, unknown>) => { data: unknown; error: unknown }),
  /** The one email connector's id ("conn-1"; a uuid where the governed door's parser must accept it). */
  connectorId: "conn-1",
}));

vi.mock("@/integrations/supabase/client", () => {
  // A chainable PostgREST stand-in: every filter returns the builder; awaiting it yields the rows
  // for the table (messages / threads), or an empty list for everything else the inbox reads.
  const builder = (table: string) => {
    const rows = () => table === "messages" ? db.messages
      : table === "threads" ? db.threads
      : table === "channel_connectors" ? [{
        id: db.connectorId, channel_type: "email", provider: "resend", display_name: "Jordan",
        from_address: "jordan@northlightadvisory.example", from_name: "Jordan", inbound_address: null,
        status: "active", active: true,
      }]
      : [];
    const result = () => ({ data: rows(), error: null, count: rows().length });
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (ok: (v: unknown) => void) => ok(result());
        if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: table === "clients" ? db.contact : null, error: null });
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
      rpc: (name: string, args?: { _id?: string }) => {
        if (name === "cancel_scheduled_message") { db.cancellations.push(args?._id ?? ""); return db.cancel(); }
        return Promise.resolve({ data: name === "current_user_tenant_id" ? "tenant-a" : [], error: null });
      },
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      functions: { invoke: (name: string, opts?: { body?: Record<string, unknown> }) => { db.invokes.push(name);
        if (name === "comms-email-command") { db.doorBodies.push(opts?.body ?? {}); if (db.doorFn) return Promise.resolve(db.doorFn(opts?.body ?? {})); return db.doorPending ?? Promise.resolve(db.doorAnswer ?? { data: { ok: true, cancelled: true }, error: null }); }
        if (name === "subagent-email-composer" && db.draft) return db.draft(); if (name === "send-message" && db.sendAnswer) return Promise.resolve(db.sendAnswer); return Promise.resolve({ data: { outcome: "queued_scheduled", message_id: "queued-1" }, error: null }); } },
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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));

import ClientsConversations from "@/pages/admin/ClientsConversations";
import { ComposeThreadDialog } from "./ComposeThreadDialog";
import { toast } from "sonner";

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
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
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
beforeEach(() => {
  vi.clearAllMocks(); db.cancellations = []; db.invokes = []; db.contact = client; db.draft = null; db.sendAnswer = null;
  db.doorBodies = []; db.doorAnswer = null; db.doorPending = null; db.doorFn = null; db.connectorId = "conn-1";
  db.cancel = async () => ({ data: true, error: null });
});
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

describe("draft assistance stays with its original conversation", () => {
  async function start() {
    const otherKey = "contact:tenant-a:contact-2";
    const otherClient = { ...client, id: "contact-2", first_name: "Test", last_name: "Recipient", client_contact_methods: [{ kind: "email", value: "other@example.test", is_primary: true }] };
    db.messages = [message({ direction: "inbound", status: "received" }), message({ id: "m-2", thread_key: otherKey, contact_id: "contact-2", direction: "inbound", status: "received", clients: otherClient })];
    db.threads = [thread, { ...thread, id: "t-2", thread_key: otherKey, contact_id: "contact-2", clients: otherClient }];
    let finish!: (answer: { data: unknown; error: unknown }) => void;
    db.draft = () => new Promise(resolve => { finish = resolve; });
    const host = await mountInbox("/solo/3855/clients/conversations");
    const select = async (key: string) => {
      const row = [...host.querySelectorAll<HTMLElement>("[data-thread-key]")].find(el => el.dataset.threadKey === key);
      expect(row).toBeTruthy(); await act(async () => { row!.click(); await flush(); });
    };
    await select(KEY);
    const draft = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Draft with Paige");
    expect(draft).toBeTruthy(); await act(async () => { draft!.click(); await flush(); });
    expect(db.invokes).toEqual(["subagent-email-composer"]);
    return { host, select, otherKey, finish };
  }
  it.each([false, true])("retains the existing same-thread positive draft path (reselect: %s)", async reselect => {
    const { host, select, finish } = await start();
    if (reselect) await select(KEY);
    await act(async () => { finish({ data: { draft: { subject: "Original inquiry", body_text: "Reply for original contact" } }, error: null }); await flush(); });
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Reply for original contact");
    expect(toast.success).toHaveBeenCalledWith("Paige drafted a reply — review before you send.");
  });
});


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

  // Communications truth (EXP03): a settled governed email never reads as plain "Sent".
  // Only the provider's delivered event says Delivered; sent/read on an accepted operation
  // say the email service took it and nothing more — the pill says Accepted.
  it.each([
    ["delivered", "Delivered"],
    ["sent", "Accepted"],
    ["read", "Accepted"],
  ])("a canonical provider receipt stays truthful after settling: %s reads %s", async (status, label) => {
    db.messages = [message({
      status,
      comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d",
      comms_email_state: "provider_accepted",
      provider_message_id: "receipt",
    })];
    db.threads = [thread];
    const host = await mountInbox("/solo/3855/clients/conversations");
    expect(host.textContent).toContain("Notes from Tuesday's planning call");
    expect(host.textContent).toContain(label);
    if (label !== "Delivered") expect(host.textContent).not.toContain("Delivered");
  });

  it("an ordinary sent email with no governed binding keeps the plain Sent pill", async () => {
    db.messages = [message({ status: "sent" })];
    db.threads = [thread];
    const host = await mountInbox("/solo/3855/clients/conversations");
    expect(host.textContent).toContain("Sent");
    expect(host.textContent).not.toContain("Accepted");
    expect(host.textContent).not.toContain("Delivered");
  });

  it("a settled operation that was NOT accepted by the provider keeps the plain Sent pill", async () => {
    db.messages = [message({
      status: "sent",
      comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d",
      comms_email_state: "failed",
    })];
    db.threads = [thread];
    const host = await mountInbox("/solo/3855/clients/conversations");
    expect(host.textContent).toContain("Sent");
    expect(host.textContent).not.toContain("Accepted");
  });

  it("an inbound read message is never relabelled as a receipt", async () => {
    db.messages = [message({
      direction: "inbound",
      status: "read",
      comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d",
      comms_email_state: "provider_accepted",
    })];
    db.threads = [thread];
    const host = await mountInbox("/solo/3855/clients/conversations");
    expect(host.textContent).not.toContain("Accepted");
    expect(host.textContent).not.toContain("Delivered");
  });
});

describe("governedEmailReceiptLabel — the receipt words come from the same bounded projection", () => {
  const base = {
    direction: "outbound" as const,
    comms_email_operation: "op-1",
    comms_email_state: "provider_accepted",
  };
  it("delivered on an accepted operation is the only Delivered", () => {
    expect(governedEmailReceiptLabel({ ...base, status: "delivered" })).toBe("Delivered");
  });
  it("sent and read on an accepted operation are Accepted, never Delivered", () => {
    expect(governedEmailReceiptLabel({ ...base, status: "sent" })).toBe("Accepted");
    expect(governedEmailReceiptLabel({ ...base, status: "read" })).toBe("Accepted");
  });
  it("non-accepted states, missing bindings, other statuses and inbound rows all read null", () => {
    expect(governedEmailReceiptLabel({ ...base, comms_email_state: "failed", status: "sent" })).toBeNull();
    expect(governedEmailReceiptLabel({ ...base, comms_email_operation: null, status: "delivered" })).toBeNull();
    expect(governedEmailReceiptLabel({ ...base, status: "queued" })).toBeNull();
    expect(governedEmailReceiptLabel({ ...base, direction: "inbound" as const, status: "delivered" })).toBeNull();
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

  it("a send prepared an hour ago that was never handed over reads Not sent — never Sending…", async () => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    db.messages = [message({ created_at: hourAgo, comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "prepared", comms_email_prepared_at: hourAgo })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).not.toContain("Sending…");
    expect(host.textContent).toContain("Not sent");
    expect(host.textContent).not.toContain("Paige drafted — awaiting your approval");
    expect(buttons(host)).not.toContain("Approve & send");
    expect(buttons(host)).not.toContain("Edit");
  });

  it("a send handed over 10 minutes ago with no outcome reads Couldn't confirm — don't resend", async () => {
    const tenMinAgo = new Date(Date.now() - 600_000).toISOString();
    db.messages = [message({ created_at: tenMinAgo, comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "dispatching", comms_email_prepared_at: tenMinAgo, comms_email_claimed_at: tenMinAgo })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).not.toContain("Sending…");
    expect(host.querySelector('[data-governed-send="unconfirmed"]')?.textContent).toBe("Couldn't confirm this went out — don't resend.");
    expect(buttons(host)).not.toContain("Approve & send");
    expect(buttons(host)).not.toContain("Edit");
  });

  it("a send handed over seconds ago still reads Sending…", async () => {
    const justNow = new Date(Date.now() - 5_000).toISOString();
    db.messages = [message({ comms_email_operation: "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", comms_email_state: "dispatching", comms_email_prepared_at: justNow, comms_email_claimed_at: justNow })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Sending…");
    expect(buttons(host)).not.toContain("Approve & send");
  });

  it("an invoice delivery in flight is treated the same way", async () => {
    db.messages = [message({ sales_invoice_operation: "1b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d", sales_invoice_state: "dispatching" })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(buttons(host)).not.toContain("Approve & send");
    expect(host.textContent).toContain("Sending…");
  });

  // "Approve now, send later" — an approved email set for later reads Scheduled, can be cancelled
  // through the governed email door (never the generic undo), and says plainly why it did not go out.
  const OPERATION = "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d";
  const inAnHour = new Date(Math.floor((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString();
  const scheduledRow = (over: Record<string, unknown> = {}) => message({ status: "queued", scheduled_for: inAnHour,
    comms_email_operation: OPERATION, comms_email_state: "prepared", comms_email_prepared_at: NOW, comms_email_send_at: inAnHour, ...over });

  it("a scheduled email reads Scheduled with its local time, and Cancel goes to the governed email door", async () => {
    db.messages = [scheduledRow()];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Scheduled");
    expect(host.textContent).not.toContain("Not sent");
    expect(host.textContent).not.toContain("Sending…");
    expect(buttons(host)).not.toContain("Approve & send");
    const cancel = host.querySelector<HTMLButtonElement>('[data-governed-send="scheduled"]');
    // 2026-10-28: the shared label names the time zone (daylight-saving review, chat scheduled email).
    const when = new Date(inAnHour).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    expect(cancel?.parentElement?.textContent).toBe(`Sends ${when}Cancel`);
    expect(cancel?.textContent).toBe("Cancel");
    expect(cancel?.getAttribute("aria-label")).toBe(`Cancel the email scheduled for ${when}`);
    await act(async () => { cancel!.click(); await flush(); });
    expect(db.doorBodies).toEqual([{ expected_tenant_id: "tenant-a", operation_id: OPERATION, cancel: true }]);
    expect(db.cancellations).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith("Canceled — it won't be sent.");
  });
  it.each([
    ["refused", "cancelled_by_owner", "Already canceled — it won't be sent."],
    ["refused", "scheduled_release_missed", "It didn't go out."],
    ["refused", undefined, "It didn't go out."],
    ["failed", undefined, "It didn't go out."],
    ["outcome_unknown", undefined, "Too late — it's already on its way."],
    ["provider_accepted", undefined, "Too late — it's already on its way."],
  ])("a cancel that came too late (%s, %s) says what really happened; only 'on its way' is an error", async (outcome, reason, line) => {
    db.messages = [scheduledRow()];
    db.threads = [thread];
    db.doorAnswer = { data: null, error: { context: { json: async () => ({ ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome, ...(reason ? { reason } : {}) }) } } };
    const host = await mountInbox(path);
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-governed-send="scheduled"]')!.click(); await flush(); });
    if (outcome === "refused" || outcome === "failed") { expect(toast).toHaveBeenCalledWith(line); expect(toast.error).not.toHaveBeenCalled(); }
    else expect(toast.error).toHaveBeenCalledWith(line);
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("the thread list marks a governed email Scheduled only while it is: past its release grace it is not", async () => {
    db.messages = [scheduledRow()];
    db.threads = [thread];
    const before = await mountInbox(path);
    expect(before.textContent).toMatch(/Scheduled · /);
    while (mounted.length) await mounted.pop()!();
    const longAgo = new Date(Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000).toISOString();
    db.messages = [scheduledRow({ scheduled_for: longAgo, comms_email_send_at: longAgo })];
    const after = await mountInbox(path);
    expect(after.textContent).not.toMatch(/Scheduled · /);
    expect(after.querySelector('[data-governed-send="scheduled"]')).toBeNull();
    expect(after.textContent).toContain("Not sent");
  });
  it("Cancel is disabled while its request is on the way, and one click sends one request", async () => {
    db.messages = [scheduledRow()];
    db.threads = [thread];
    let answer!: (v: { data: unknown; error: unknown }) => void;
    db.doorPending = new Promise((resolve) => { answer = resolve; });
    const host = await mountInbox(path);
    const cancel = () => host.querySelector<HTMLButtonElement>('[data-governed-send="scheduled"]')!;
    await act(async () => { cancel().click(); await flush(); });
    expect(cancel().disabled).toBe(true);
    expect(cancel().textContent).toBe("Canceling…");
    await act(async () => { cancel().click(); await flush(); });
    expect(db.doorBodies).toHaveLength(1);
    await act(async () => { answer({ data: { ok: true, cancelled: true }, error: null }); await flush(); });
    expect(cancel().disabled).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Canceled — it won't be sent.");
  });
  it("a scheduled email its owner canceled reads Canceled (neutral), not the red Not sent", async () => {
    db.messages = [scheduledRow({ status: "blocked", scheduled_for: null, comms_email_state: "refused", comms_email_reason: "cancelled_by_owner" })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Canceled");
    expect(host.textContent).not.toContain("Not sent");
    expect(host.querySelector('[data-governed-send="not_sent"]')?.textContent).toBe("Canceled — it won't be sent.");
  });
  it.each([
    ["blocked_suppressed", "Not sent — this address can't get email from you (they unsubscribed or it bounced)."],
    ["blocked_client_dnd", "Not sent — this person asked not to be contacted right now."],
    ["blocked_no_consent", "Not sent — this person hasn't agreed to get email from you."],
    ["blocked_unsubscribe_unavailable", "Not sent — an unsubscribe link couldn't be added to it."],
    ["blocked_something_new", "Not sent — this person can't be emailed right now."],
    ["sender_changed", "Not sent — the sending address or this person's email changed since it was scheduled."],
    ["scheduler_authority_removed", "Not sent — the person who scheduled it no longer has access to this business."],
    ["scheduled_release_missed", "Nothing went out."],
  ])("a scheduled email closed as %s reads Not sent with one plain line and no cancel", async (reason, line) => {
    db.messages = [scheduledRow({ status: "blocked", scheduled_for: null, comms_email_state: "refused", comms_email_reason: reason })];
    db.threads = [thread];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Not sent");
    expect(host.querySelector('[data-governed-send="not_sent"]')?.textContent).toBe(line);
    expect(host.querySelector('[data-governed-send="scheduled"]')).toBeNull();
    expect(host.textContent).not.toMatch(/cancelled_by_owner|blocked_[a-z_]+|scheduler_authority_removed|scheduled_release_missed|sender_changed/);
  });
});

describe("a scheduled governed email's state, with the clock injected", () => {
  const T0 = Date.parse("2026-11-02T14:30:00.000Z");
  const row = (over: Record<string, unknown>) => ({ comms_email_operation: "op", comms_email_state: "prepared", comms_email_prepared_at: "2026-11-01T10:00:00.000Z",
    comms_email_send_at: "2026-11-02T14:30:00.000Z", status: "queued", created_at: "2026-11-01T10:00:00.000Z", direction: "outbound", ...over }) as unknown as MessageRow;
  it("Scheduled before its time, Sending… inside the release grace, Not sent after it", () => {
    expect(governedSendView(row({}), T0 - 1)).toBe("scheduled");
    expect(governedSendView(row({}), T0)).toBe("sending");
    expect(governedSendView(row({}), T0 + SCHEDULED_RELEASE_GRACE_MS)).toBe("sending");
    expect(governedSendView(row({}), T0 + SCHEDULED_RELEASE_GRACE_MS + 1)).toBe("not_sent");
  });
  it("only a queued row is Scheduled; the release grace is the server's", () => {
    expect(governedSendView(row({ status: "draft" }), T0 - 60_000)).toBe("not_sent");
    expect(SCHEDULED_RELEASE_GRACE_MS).toBe(15 * 60_000);
  });
  it("claimed, refused and accepted scheduled rows follow the ordinary rules", () => {
    expect(governedSendView(row({ comms_email_state: "refused", status: "blocked" }), T0 - 1)).toBe("not_sent");
    expect(governedSendView(row({ comms_email_state: "dispatching", status: "draft", comms_email_claimed_at: new Date(T0 - 1000).toISOString() }), T0)).toBe("sending");
    expect(governedSendView(row({ comms_email_state: "provider_accepted", status: "sent" }), T0)).toBe("settled");
  });
  it("a scheduled row is never an approvable draft", () => {
    expect(isApprovableDraft(row({}))).toBe(false);
  });
  it("isScheduledMessage: a governed email only before its time; an ordinary queued draft whenever it is queued", () => {
    expect(isScheduledMessage(row({}), T0 - 1)).toBe(true);
    expect(isScheduledMessage(row({}), T0 + 1)).toBe(false);
    expect(isScheduledMessage(row({}), T0 + SCHEDULED_RELEASE_GRACE_MS + 1)).toBe(false);
    const ordinary = { status: "queued", scheduled_for: "2026-11-02T14:30:00.000Z", direction: "outbound", created_at: "2026-11-01T10:00:00.000Z" } as unknown as MessageRow;
    expect(isScheduledMessage(ordinary, T0 + 86_400_000)).toBe(true);
    expect(isScheduledMessage({ ...ordinary, status: "sent" } as MessageRow, T0)).toBe(false);
  });
  it("cancelTooLateLine reads the send's recorded state", () => {
    expect(cancelTooLateLine("refused", "cancelled_by_owner")).toBe("Already canceled — it won't be sent.");
    for (const r of ["scheduled_release_missed", "blocked_quiet_hours", undefined]) expect(cancelTooLateLine("refused", r)).toBe("It didn't go out.");
    expect(cancelTooLateLine("failed")).toBe("It didn't go out.");
    for (const o of ["dispatching", "unknown", "outcome_unknown", "provider_accepted", undefined]) expect(cancelTooLateLine(o)).toBe("Too late — it's already on its way.");
  });
  it("governedNotSentLine never shows a code", () => {
    expect(governedNotSentLine("cancelled_by_owner")).toBe("Canceled — it won't be sent.");
    expect(governedNotSentLine("blocked_no_consent")).toBe("Not sent — this person hasn't agreed to get email from you.");
    expect(governedNotSentLine("blocked_client_dnd")).not.toMatch(/opted out/);
    expect(governedNotSentLine("send_no_longer_eligible")).toMatch(/changed since it was scheduled/);
    expect(governedNotSentLine(null)).toBe("Nothing went out.");
    expect(governedNotSentLine("weird_code")).toBe("Nothing went out.");
  });
  it("the select reads the send time and the refusal reason (and still nothing else from meta)", () => {
    expect(GOVERNED_SEND_COLS).toContain("comms_email_send_at:meta->comms_email_binding->>send_at");
    expect(GOVERNED_SEND_COLS).toContain("comms_email_reason:meta->comms_email_binding->>outcome_reason");
    expect(GOVERNED_SEND_COLS).not.toMatch(/->>(command|governance|body)/);
  });
});

// The new-conversation dialog's scheduled Undo — THIS PR's code (ComposeThreadDialog calls
// requestScheduledCancellation). The inbox-surface variants it once shared a describe with were
// superseded by main's Conversations hardening and stay retired; main's own suites cover that flow.
describe("the new-conversation dialog's scheduled cancellation receipts", () => {
  const outcomes: Array<[string, () => Promise<{data: unknown; error: unknown}>]> = [
    ["false", async () => ({data:false,error:null})],
    ["missing", async () => ({data:null,error:null})],
    ["truthy malformed", async () => ({data:"true",error:null})],
    ["missing error envelope", async () => ({data:true,error:undefined})],
    ["error alongside true", async () => ({data:true,error:{message:"refused"}})],
    ["transport rejection", async () => { throw new Error("offline"); }],
  ];
  async function queueWithUndo() {
    const holder = document.createElement("div"); document.body.appendChild(holder);
    const root = createRoot(holder);
    const render = (tenant: string, open = true) => root.render(<MemoryRouter><ComposeThreadDialog open={open} onOpenChange={()=>{}} activeConnectors={[{id:"conn-1",channel_type:"email",provider:"resend",display_name:"Test business email",from_address:"hello@business.example"}]} tenantId={tenant} initialContact={{id:"contact-1",name:"Test lead"}} onSent={()=>{}} /></MemoryRouter>);
    await act(async () => { render("tenant-a"); await flush(); });
    for (let i=0;i<3;i++) await act(async () => { await flush(); });
    mounted.push(async () => { await act(async () => {root.unmount();});holder.remove(); });
    const changeTenant = async (tenant: string) => {await act(async () => {render(tenant);await flush();});};
    const closeSameWorkspace = async () => {await act(async () => {render("tenant-a",false);await flush();});};
    const host = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(host).toBeTruthy();
    const subject = host.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!;
    const body = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(subject,"Test scheduled reply");
      subject.dispatchEvent(new Event("input",{bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(body,"Please keep this draft.");
      body.dispatchEvent(new Event("input",{bubbles:true})); await flush();
    });
    const send = [...host.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Send")!;
    expect(send).toBeTruthy(); expect(send.disabled).toBe(false);
    await act(async () => {send.click();await flush();});
    expect(db.invokes).toEqual(["send-message"]);
    const call = vi.mocked(toast).mock.calls.find(([,options]) => (options as {action?:{label?:string}}|undefined)?.action?.label === "Undo");
    expect(call).toBeTruthy();
    const undo = (call![1] as unknown as {action:{onClick:()=>void}}).action.onClick;
    return {undo,changeTenant,closeSameWorkspace};
  }
  it.each(outcomes)("reports %s as unconfirmed without inventing delivery or cancellation", async (_name,cancel) => {
    db.cancel = cancel;
    const {undo} = await queueWithUndo();
    await act(async () => {undo();await flush();});
    expect(db.cancellations).toEqual(["queued-1"]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't confirm cancellation. Check this conversation's status before trying again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(db.invokes).toEqual(["send-message"]);
  });
  it("retains the confirmed Undo result",async()=>{
    const {undo}=await queueWithUndo();
    await act(async()=>{undo();await flush();});
    expect(db.cancellations).toEqual(["queued-1"]);
    expect(toast.success).toHaveBeenCalledWith("Undone.");
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("never invokes an old Undo after switching workspaces A-B-A",async()=>{
    const {undo,changeTenant}=await queueWithUndo();
    await changeTenant("tenant-b"); await changeTenant("tenant-a");
    vi.mocked(toast.error).mockClear();vi.mocked(toast.success).mockClear();
    await act(async()=>{undo();await flush();});
    expect(db.cancellations).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
  });
  it("never invokes an old Undo after its component unmounts",async()=>{
    const {undo}=await queueWithUndo(); await mounted.pop()!();
    vi.mocked(toast.error).mockClear();vi.mocked(toast.success).mockClear();
    await act(async()=>{undo();await flush();});
    expect(db.cancellations).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
  });
  it("keeps Undo usable after closing the dialog in the same workspace",async()=>{
    const {undo,closeSameWorkspace}=await queueWithUndo(); await closeSameWorkspace();
    await act(async()=>{undo();await flush();});
    expect(db.cancellations).toEqual(["queued-1"]);
    expect(toast.success).toHaveBeenCalledWith("Undone.");
  });
  it.each([true,false])("ignores a late %s cancellation answer after a workspace switch",async result=>{
    let settle!: (receipt:{data:boolean;error:null})=>void;
    db.cancel=()=>new Promise(resolve=>{settle=resolve;});
    const {undo,changeTenant}=await queueWithUndo();
    await act(async()=>{undo();await flush();});
    expect(db.cancellations).toEqual(["queued-1"]);
    await changeTenant("tenant-b");
    vi.mocked(toast.success).mockClear();vi.mocked(toast.error).mockClear();
    await act(async()=>{settle({data:result,error:null});await flush();});
    expect(toast.success).not.toHaveBeenCalled();expect(toast.error).not.toHaveBeenCalled();
  });
  it("ignores a late cancellation answer after unmount",async()=>{
    let settle!: (receipt:{data:boolean;error:null})=>void;
    db.cancel=()=>new Promise(resolve=>{settle=resolve;});
    const {undo}=await queueWithUndo();
    await act(async()=>{undo();await flush();});
    await mounted.pop()!();
    vi.mocked(toast.success).mockClear();vi.mocked(toast.error).mockClear();
    await act(async()=>{settle({data:true,error:null});await flush();});
    expect(toast.success).not.toHaveBeenCalled();expect(toast.error).not.toHaveBeenCalled();
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

describe("Sending… is time-bound — the clock is injected", () => {
  const row = (over: Record<string, unknown>) => message(over) as unknown as MessageRow;
  const T0 = Date.parse("2026-10-05T12:00:00.000Z");
  const at = (msAgo: number) => new Date(T0 - msAgo).toISOString();
  const comms = (state: string, preparedAgo: number | null, claimedAgo: number | null, over: Record<string, unknown> = {}) =>
    row({
      created_at: at(preparedAgo ?? 0), comms_email_operation: "x", comms_email_state: state,
      comms_email_prepared_at: preparedAgo === null ? null : at(preparedAgo),
      comms_email_claimed_at: claimedAgo === null ? null : at(claimedAgo), ...over,
    });

  it("the select reads the binding's prepared_at and claimed_at (and still nothing else from meta)", () => {
    expect(GOVERNED_SEND_COLS).toContain("comms_email_prepared_at:meta->comms_email_binding->>prepared_at");
    expect(GOVERNED_SEND_COLS).toContain("comms_email_claimed_at:meta->comms_email_binding->>claimed_at");
    expect(GOVERNED_SEND_COLS).not.toMatch(/->>(command|governance|body)/);
  });
  it("the window is about two minutes", () => {
    expect(SENDING_WINDOW_MS).toBe(120_000);
  });
  it("dispatching: Sending… only while the claim is fresh, then Couldn't confirm", () => {
    expect(governedSendView(comms("dispatching", 30_000, 20_000), T0)).toBe("sending");
    expect(governedSendView(comms("dispatching", 600_000, 119_000), T0)).toBe("sending");
    expect(governedSendView(comms("dispatching", 600_000, 121_000), T0)).toBe("unconfirmed");
    expect(governedSendView(comms("dispatching", 3_600_000, 3_600_000), T0)).toBe("unconfirmed");
    // A claim time that cannot be read falls back to when the row was written.
    expect(governedSendView(comms("dispatching", 3_600_000, null), T0)).toBe("unconfirmed");
    expect(governedSendView(comms("dispatching", 30_000, null), T0)).toBe("sending");
  });
  it("prepared: Sending… only in the first two minutes, then Not sent (nothing was handed over)", () => {
    expect(governedSendView(comms("prepared", 10_000, null), T0)).toBe("sending");
    expect(governedSendView(comms("prepared", 3_600_000, null), T0)).toBe("not_sent");
    expect(governedSendView(comms("prepared", 121_000, null), T0)).toBe("not_sent");
  });
  it("refused or blocked: Not sent; unknown: Couldn't confirm; accepted and failed: settled", () => {
    expect(governedSendView(comms("refused", 10_000, null, { status: "blocked" }), T0)).toBe("not_sent");
    expect(governedSendView(comms("refused", 10_000, null), T0)).toBe("not_sent");
    expect(governedSendView(comms("blocked", 10_000, null), T0)).toBe("not_sent");
    expect(governedSendView(comms("unknown", 10_000, 5_000), T0)).toBe("unconfirmed");
    expect(governedSendView(comms("unknown", 3_600_000, 3_600_000), T0)).toBe("unconfirmed");
    expect(governedSendView(comms("provider_accepted", 3_600_000, 3_600_000, { status: "sent" }), T0)).toBe("settled");
    expect(governedSendView(comms("failed", 3_600_000, 3_600_000, { status: "failed" }), T0)).toBe("settled");
  });
  it("an invoice binding carries no times, so its age is the row's own creation", () => {
    const inv = (state: string, ago: number) => row({ created_at: at(ago), sales_invoice_operation: "y", sales_invoice_state: state });
    expect(governedSendView(inv("dispatching", 20_000), T0)).toBe("sending");
    expect(governedSendView(inv("dispatching", 3_600_000), T0)).toBe("unconfirmed");
    expect(governedSendView(inv("prepared", 3_600_000), T0)).toBe("not_sent");
  });
  it("a binding with no readable state never says Sending… forever", () => {
    expect(governedSendView(row({ created_at: at(10_000), comms_email_operation: "x" }), T0)).toBe("sending");
    expect(governedSendView(row({ created_at: at(3_600_000), comms_email_operation: "x" }), T0)).toBe("unconfirmed");
  });
  it("no bound row is ever approvable, at any age", () => {
    for (const state of ["prepared", "dispatching", "unknown", "refused"]) {
      expect(isApprovableDraft(comms(state, 3_600_000, 3_600_000))).toBe(false);
    }
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
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const op = "0b6d8c43-5a77-4f3b-9d0e-1c2f3a4b5c6d";
    const scenes: Array<{ label: string; note: string; row: Record<string, unknown> }> = [
      { label: "A draft Paige wrote — unchanged", note: "Still the one card that asks for approval, with Approve & send.", row: {} },
      { label: "An approved email on its way", note: "Approved in chat and handed to the email service seconds ago. No approve, no edit — it is already going.", row: { created_at: ago(8_000), comms_email_operation: op, comms_email_state: "dispatching", comms_email_prepared_at: ago(8_000), comms_email_claimed_at: ago(6_000) } },
      { label: "An email nobody could confirm", note: "The send was attempted and the outcome never came back. It may have gone out, so it says not to resend.", row: { comms_email_operation: op, comms_email_state: "unknown" } },
      { label: "Handed over, no answer for ten minutes", note: "Claimed and handed to the email service, then nothing came back. Sending… stops after two minutes; it may have gone out, so it says not to resend.", row: { created_at: ago(600_000), comms_email_operation: op, comms_email_state: "dispatching", comms_email_prepared_at: ago(600_000), comms_email_claimed_at: ago(598_000) } },
      { label: "Approved an hour ago, never handed over", note: "Prepared but never claimed, so nothing reached the email service. It reads Not sent — never Sending… forever.", row: { created_at: ago(3_600_000), comms_email_operation: op, comms_email_state: "prepared", comms_email_prepared_at: ago(3_600_000) } },
    ];
    const captured: string[] = [];
    for (const scene of scenes) {
      db.messages = [
        message({ id: "in-1", direction: "inbound", status: "received", sender: { address: "maya@ortizlandscaping.example", display_name: "Maya Ortiz" }, subject: "Tuesday", body_text: "Could you send over what we agreed on Tuesday?", created_at: new Date(Date.now() - 2 * 3600_000).toISOString() }),
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

// Experience 03: SendGrid has no idempotent replay, so an email whose answer was lost may already be in the
// client's inbox. send-message answers it outcome_unknown + unconfirmed, and marks its row
// error = "delivery_unconfirmed". The inbox must say so — never "Failed", never an invitation to resend.
describe("an email the service may have taken (its answer was lost)", () => {
  const UNCONFIRMED = { data: { status: "failed", outcome: "outcome_unknown", unconfirmed: true, error: "delivery_unconfirmed: sendgrid_503", reason: "delivery_unconfirmed: sendgrid_503", message_id: "m-1" }, error: null };
  const COPY = "We couldn't confirm it was sent — it may already be with them. Don't send it again until you've asked them.";

  it("a row marked unconfirmed reads Couldn't confirm with the don't-resend line, never Failed", async () => {
    db.messages = [message({ status: "failed", error: "delivery_unconfirmed" })];
    db.threads = [thread];
    const host = await mountInbox("/admin/clients/conversations");
    expect(host.textContent).toContain("Couldn't confirm");
    expect(host.textContent).toContain("Couldn't confirm this went out — don't resend.");
    expect(host.textContent).not.toContain("Failed");
    expect(host.textContent).not.toContain("delivery_unconfirmed");
    // The line means "not a failure", so it is never painted in the failure colour.
    const line = [...host.querySelectorAll("p")].find((p) => p.textContent?.trim() === "Couldn't confirm this went out — don't resend.");
    expect(line).toBeTruthy();
    expect(line!.className).not.toContain("destructive");
  });

  it("a provider refusal reads as owner copy, never the raw provider error", async () => {
    db.messages = [message({ status: "failed", error: 'sendgrid_400: {"errors":[{"message":"Does not contain a valid address.","field":"personalizations.0.to.0.email"}]}' })];
    db.threads = [thread];
    const host = await mountInbox("/admin/clients/conversations");
    expect(host.textContent).toContain("Not sent — that email address wasn't accepted. Check it and try again.");
    expect(host.textContent).not.toContain("sendgrid_400");
  });

  it("a plain failure still reads Failed (unchanged)", async () => {
    db.messages = [message({ status: "failed", error: "sendgrid_400: bad recipient" })];
    db.threads = [thread];
    const host = await mountInbox("/admin/clients/conversations");
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).not.toContain("Couldn't confirm");
    expect(host.textContent).not.toContain("sendgrid_400");
  });

  it("Approve & send whose answer was lost warns honestly instead of reporting a failure", async () => {
    db.messages = [message({})];
    db.threads = [thread];
    db.sendAnswer = UNCONFIRMED;
    const host = await mountInbox("/admin/clients/conversations");
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Approve & send")!;
    expect(approve).toBeTruthy();
    await act(async () => { approve.click(); await flush(); });
    expect(db.invokes).toEqual(["send-message"]);
    expect(toast.warning).toHaveBeenCalledWith(COPY);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // EXP03 O12 piece 3: the reply composer's email no longer goes through send-message's undo window. It is
  // checked and confirmed through the governed door; a confirm whose answer is unknown clears the composer
  // (it may already be with them) and says not to resend — never a failure.
  it("the reply composer's email whose confirm answer is unknown says don't resend, never a failure, and keeps the words", async () => {
    const contact = "0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5";
    const key = `contact:tenant-a:${contact}`;
    db.connectorId = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
    db.messages = [message({ status: "sent", thread_key: key, contact_id: contact, connector_id: db.connectorId })];
    db.threads = [{ ...thread, thread_key: key, contact_id: contact, clients: { ...client, id: contact } }];
    const host = await mountInbox("/admin/clients/conversations");
    const body = host.querySelector<HTMLTextAreaElement>("textarea")!;
    const subject = host.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!;
    expect(body).toBeTruthy(); expect(subject).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(subject, "Thursday");
      subject.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(body, "Following up on Thursday.");
      body.dispatchEvent(new Event("input", { bubbles: true })); await flush();
    });
    // The check: a 202 naming the request's own operation, exactly as the door answers.
    db.doorFn = (b) => ({ data: { ok: false, outcome: "approval_required", fingerprint: "0123456789abcdef", operation_id: b.operation_id, expires_at: new Date(Date.now() + 600_000).toISOString(),
      preview: { kind: "email", to_name: "Maya Ortiz", to_address: "maya@ortizlandscaping.example", from_address: "jordan@northlightadvisory.example", subject: "Thursday", body_text: "Following up on Thursday." } }, error: null });
    const send = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Send")!;
    expect(send).toBeTruthy();
    await act(async () => { send.click(); await flush(); });
    for (let i = 0; i < 3; i++) await act(async () => { await flush(); });
    const sendNow = host.querySelector<HTMLButtonElement>('[data-strip-focus="confirm"]')!;
    expect(sendNow?.textContent).toBe("Send now");
    db.doorFn = null;
    db.doorAnswer = { data: null, error: { context: { status: 503, json: async () => ({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" }) } } };
    await act(async () => { sendNow.click(); await flush(); });
    for (let i = 0; i < 3; i++) await act(async () => { await flush(); });
    expect(db.invokes).toEqual(["comms-email-command", "comms-email-command"]);
    expect(db.doorBodies[1]).toMatchObject({ operation_id: db.doorBodies[0].operation_id, approved_fingerprint: "0123456789abcdef" });
    expect(host.querySelector("[data-governed-reply-strip]")?.textContent).toContain("Couldn't confirm this went out — don't resend.");
    expect(toast.error).not.toHaveBeenCalled();
    // Words stay until a definite answer: asking again replays the same operation.
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Following up on Thursday.");
  });

  it("the new-conversation dialog warns honestly and closes, leaving no Send that would mail a second copy", async () => {
    db.sendAnswer = UNCONFIRMED;
    const onOpenChange = vi.fn(); const onSent = vi.fn();
    const holder = document.createElement("div"); document.body.appendChild(holder);
    const root = createRoot(holder);
    await act(async () => { root.render(<MemoryRouter><ComposeThreadDialog open onOpenChange={onOpenChange} activeConnectors={[{id:"conn-1",channel_type:"email",provider:"resend",display_name:"Test business email",from_address:"hello@business.example"}]} tenantId="tenant-a" initialContact={{id:"contact-1",name:"Test lead"}} onSent={onSent} /></MemoryRouter>); await flush(); });
    for (let i = 0; i < 3; i++) await act(async () => { await flush(); });
    mounted.push(async () => { await act(async () => { root.unmount(); }); holder.remove(); });
    const host = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const subject = host.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!;
    const body = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(subject,"Checking in");
      subject.dispatchEvent(new Event("input",{bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(body,"Hello there.");
      body.dispatchEvent(new Event("input",{bubbles:true})); await flush();
    });
    const send = [...host.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Send")!;
    await act(async () => { send.click(); await flush(); });
    expect(db.invokes).toEqual(["send-message"]);
    expect(toast.warning).toHaveBeenCalledWith(COPY);
    expect(toast.error).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSent).toHaveBeenCalled();
  });
});
