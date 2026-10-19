/**
 * E09 — portal messages in the business owner's Conversations inbox, and the portal reply.
 *
 * Mounts the REAL inbox (`ClientsConversations`, at the Solo route and the admin route) against a
 * stubbed database and proves: portal rows and help requests are labelled; the composer offers
 * Portal for a portal-connected client; Send calls comms_portal_reply (never send-message); a retry
 * of the same text reuses its request id; each error code reaches the owner as plain copy.
 *
 * PROOF CLASS: rendered harness (jsdom) — the real component tree with the database stubbed. Not an
 * authenticated runtime drive; the RPC itself is proven by supabase/tests, not here.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  connectors: [] as Array<Record<string, unknown>>,
  signatures: [] as Array<Record<string, unknown>>,
  /** Realtime handlers the inbox subscribed, so a test can deliver "a new message arrived". */
  realtime: [] as Array<{ table: string; handler: () => void }>,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  portalReplies: [] as Array<{ data: unknown; error: unknown }>,
  invokes: [] as Array<{ name: string; body: unknown }>,
  /** E09 Slice 7: the database has not got the access columns yet (web deployed first). */
  premigration: false,
  threadSelects: [] as string[],
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const rows = () => table === "messages" ? db.messages
      : table === "threads" ? db.threads
      : table === "channel_connectors" ? db.connectors
      : table === "signatures" ? db.signatures
      : [];
    let selected = "";
    const result = () => table === "threads" && db.premigration && /portal_access/.test(selected)
      ? { data: null, error: { code: "42703", message: "column clients_1.portal_access_state does not exist" }, count: null }
      : { data: rows(), error: null, count: rows().length };
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "select") return (cols: string) => { selected = String(cols ?? ""); if (table === "threads") db.threadSelects.push(selected); return proxy; };
        if (key === "then") return (ok: (v: unknown) => void) => ok(result());
        if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
        return () => proxy;
      },
    });
    return proxy;
  };
  const channel: Record<string, unknown> = {
    on: (_event: string, filter: { table?: string }, handler: () => void) => {
      db.realtime.push({ table: filter?.table ?? "", handler });
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: unknown) => {
        db.rpcCalls.push({ name, args });
        if (name === "current_user_tenant_id") return Promise.resolve({ data: "tenant-a", error: null });
        if (name === "comms_portal_reply") {
          return Promise.resolve(db.portalReplies.shift() ?? { data: { ok: true, replayed: false, message_id: "m-new", created_at: new Date().toISOString() }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      functions: { invoke: (name: string, opts: { body: unknown }) => { db.invokes.push({ name, body: opts?.body }); return Promise.resolve({ data: null, error: null }); } },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), remove: () => Promise.resolve({ data: null, error: null }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
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
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("sonner", () => ({ toast }));

import ClientsConversations from "@/pages/admin/ClientsConversations";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = function scrollIntoView() {};
// jsdom gaps the Radix Select (the composer's sending-address picker) touches.
Element.prototype.hasPointerCapture ||= () => false;
Element.prototype.releasePointerCapture ||= () => {};
globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} } as never;

const KEY = "contact:tenant-a:contact-1";
const T0 = Date.now() - 10 * 60_000;
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const methods = [{ kind: "email", value: "maya@ortizlandscaping.example", is_primary: true }];
const client = (linked: string | null, contactMethods = methods) => ({
  id: "contact-1", first_name: "Maya", last_name: "Ortiz", entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: null, source: null, tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: linked, timezone: null, created_at: at(0), created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null,
  client_contact_methods: contactMethods,
});
const base = {
  thread_key: KEY, contact_id: "contact-1", connector_id: null, body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null, scheduled_for: null,
  call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: "Maya", last_name: "Ortiz", entity_name: null, client_contact_methods: methods },
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
};
const emailIn = {
  ...base, id: "m-email", connector_id: "conn-1", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: "maya@ortizlandscaping.example", display_name: "Maya Ortiz" }, recipients: [],
  subject: "Spring planting", body_text: "Can we move the walkthrough?", sent_at: at(1), created_at: at(1),
};
const portalIn = {
  ...base, id: "m-portal", channel_type: "portal", direction: "inbound", status: "received",
  sender: { kind: "customer", name: "Maya Ortiz" }, recipients: [], subject: null,
  body_text: "Thanks — saw the plan in the portal.", sent_at: at(2), created_at: at(2),
};
const portalHelp = {
  ...base, id: "m-help", channel_type: "portal", direction: "inbound", status: "received",
  sender: { kind: "customer", name: "Maya Ortiz" }, recipients: [], subject: "Help request",
  body_text: "I can't find my invoice.", sent_at: at(3), created_at: at(3),
};
const portalOut = {
  ...base, id: "m-reply", channel_type: "portal", direction: "outbound", status: "delivered",
  sender: { kind: "business", user_id: "owner-1" }, recipients: [], subject: null,
  body_text: "It's under Billing — sending a link now.", sent_at: at(4), created_at: at(4),
};
const thread = (linked: string | null, lastDirection = "inbound", contactMethods = methods) => ({
  id: "t-1", thread_key: KEY, contact_id: "contact-1", snoozed_until: null, archived_at: null, labels: [],
  unread_count: 0, last_message_at: at(4), last_direction: lastDirection, clients: client(linked, contactMethods),
});
const emailConnector = {
  id: "conn-1", channel_type: "email", provider: "resend", display_name: "Jordan",
  from_address: "jordan@northlightadvisory.example", from_name: "Jordan", inbound_address: null,
  status: "active", active: true,
};

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { while (mounted.length) await mounted.pop()!(); });
beforeEach(() => {
  db.rpcCalls = []; db.portalReplies = []; db.invokes = []; db.signatures = []; db.realtime = [];
  db.premigration = false; db.threadSelects = [];
  db.connectors = [emailConnector];
  toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
});

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

const composerBox = (host: HTMLElement) => {
  const box = Array.from(host.querySelectorAll("textarea")).find((t) => /Message .* client portal|Reply to/.test(t.placeholder));
  if (!box) throw new Error("composer textarea not found");
  return box;
};
async function type(host: HTMLElement, text: string) {
  const box = composerBox(host);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  });
}
const sendButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Send") as HTMLButtonElement | undefined;
async function clickSend(host: HTMLElement) {
  const btn = sendButton(host);
  if (!btn) throw new Error("Send button not found");
  await act(async () => { btn.click(); await flush(); });
  for (let i = 0; i < 2; i += 1) await act(async () => { await flush(); });
}
/** Pick a sending address in the composer's picker, by keyboard (the way Radix Select is driven). */
async function chooseIdentity(host: HTMLElement, match: RegExp) {
  const trigger = Array.from(host.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'))
    .find((b) => /Portal|Jordan|Sending address/.test(b.textContent ?? ""));
  if (!trigger) throw new Error("sending-address picker not found");
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  await act(async () => { key(trigger, "Enter"); await flush(); });
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => match.test(o.textContent ?? ""));
  if (!option) throw new Error(`no sending address matching ${match}`);
  await act(async () => { key(option, "Enter"); await flush(); });
  for (let i = 0; i < 2; i += 1) await act(async () => { await flush(); });
}
/** A new message lands in the thread: the inbox's realtime subscription fires and it reloads. */
async function messageArrives(host: HTMLElement, row: Record<string, unknown>) {
  db.messages = [...db.messages, row];
  await act(async () => {
    for (const { table, handler } of db.realtime) if (table === "messages") handler();
    await flush();
  });
  for (let i = 0; i < 3; i += 1) await act(async () => { await flush(); });
  return host;
}
const signatureToggle = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((b) => /^Signature (on|off)$/.test((b.textContent ?? "").trim()));
const MAYA_EMAIL = "maya@ortizlandscaping.example";
const portalCalls = () => db.rpcCalls.filter((c) => c.name === "comms_portal_reply").map((c) => c.args as Record<string, string>);

describe.each([
  ["Solo", "/solo/3855/clients/conversations"],
  ["the admin inbox", "/admin/clients/conversations"],
])("%s — portal messages in the owner's inbox", (_label, path) => {
  it("labels portal messages and help requests in the thread and the rail", async () => {
    db.messages = [emailIn, portalIn, portalHelp, portalOut];
    db.threads = [thread("cust-user-1", "outbound")];
    const host = await mountInbox(path);
    const text = host.textContent ?? "";
    expect(text).toContain("Portal · Maya Ortiz");
    expect(text).toContain("Portal · You");
    expect(text).toContain("Help request");
    expect(text).toContain("I can't find my invoice.");
    // Email in the same thread keeps its own sender label — not mislabelled as portal.
    expect(text).toContain("Can we move the walkthrough?");
    // A business portal message is never presented as read.
    expect(text).not.toMatch(/\bRead\b|\bSeen\b/);
  });

  it("leads the rail preview with the help request", async () => {
    db.messages = [portalIn, portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    const row = host.querySelector(`[data-thread-key="${KEY}"]`);
    expect(row?.textContent).toContain("Help request: I can't find my invoice.");
  });

  it("defaults the reply to Portal for a portal conversation and posts through comms_portal_reply only", async () => {
    db.messages = [portalIn, portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
    expect(host.textContent).toContain("Posts in Maya Ortiz's client portal — no email or text goes out.");
    // Portal is text-only and immediate: no Attach, no Schedule.
    const labels = Array.from(host.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    expect(labels).not.toContain("Attach");
    expect(labels).not.toContain("Schedule");

    await type(host, "  It's under Billing.  ");
    await clickSend(host);
    expect(portalCalls()).toHaveLength(1);
    expect(portalCalls()[0]).toMatchObject({ p_tenant_id: "tenant-a", p_contact_id: "contact-1", p_body: "It's under Billing." });
    expect(portalCalls()[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.invokes.filter((i) => i.name === "send-message")).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Posted to Maya Ortiz's client portal.");
    expect(composerBox(host).value).toBe("");
  });

  it("reuses the request id when the same message is retried, and mints a new one for the next message", async () => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    db.portalReplies = [
      { data: null, error: { code: "08006", message: "connection failure" } },
      { data: { ok: true, replayed: true, message_id: "m-new", created_at: at(5) }, error: null },
    ];
    await type(host, "Checking now.");
    await clickSend(host);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("won't post twice"));
    expect(composerBox(host).value).toBe("Checking now."); // the owner's text is kept for the retry
    await clickSend(host);
    const [first, second] = portalCalls();
    expect(second.p_request_id).toBe(first.p_request_id);
    expect(toast.success).toHaveBeenCalledTimes(1);

    await type(host, "Anything else?");
    await clickSend(host);
    expect(portalCalls()[2].p_request_id).not.toBe(first.p_request_id);
  });

  it.each([
    ["PORTAL_NOT_CONNECTED", "Maya Ortiz hasn't joined your client portal yet"],
    ["CONTACT_NOT_FOUND", "isn't an active client in this workspace"],
    ["INVALID_BODY", "between 1 and 4,000 characters"],
    ["REQUEST_ID_CONFLICT", "clashed with an earlier one"],
    ["WORKSPACE_INACTIVE", "workspace isn't active, so its client portal can't receive messages"],
  ])("maps %s to plain copy and keeps the text", async (code, copy) => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    db.portalReplies = [{ data: { ok: false, error: code }, error: null }];
    await type(host, "Hello there");
    await clickSend(host);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(copy));
    expect(toast.success).not.toHaveBeenCalled();
    expect(composerBox(host).value).toBe("Hello there");
  });

  it("tells a non-admin plainly that only business admins reply in the portal", async () => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    db.portalReplies = [{ data: null, error: { code: "42501", message: "not authorized for this business inbox" } }];
    await type(host, "Hello there");
    await clickSend(host);
    expect(toast.error).toHaveBeenCalledWith("Only admins of this business can reply in the client portal.");
  });

  it("offers Portal even with no email or SMS connected, instead of the connect-a-channel dead end", async () => {
    db.connectors = [];
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
  });

  it("keeps an email thread on email when the client has no portal (behaviour unchanged)", async () => {
    db.messages = [emailIn];
    db.threads = [thread(null)];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
    expect(host.textContent).toContain("To maya@ortizlandscaping.example");
    expect(host.textContent).not.toContain("Portal ·");
  });

  it("keeps an email thread on email for a portal client until the owner picks Portal", async () => {
    db.messages = [portalIn, emailIn].map((m, i) => ({ ...m, sent_at: at(i + 1), created_at: at(i + 1) }));
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
  });

  it("counts emoji as the server does: 3,600 emoji is under the 4,000 limit and posts", async () => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    const emoji = "\u{1F33F}";
    // 4,001 code points is over the server's limit: nothing is posted.
    await type(host, emoji.repeat(4001));
    expect(host.textContent).toContain("4,001 / 4,000 characters.");
    await clickSend(host);
    expect(portalCalls()).toHaveLength(0);
    // 3,600 code points — 7,200 UTF-16 units — is within it, and is counted as the server counts it.
    await type(host, emoji.repeat(3600));
    expect(host.textContent).toContain("3,600 / 4,000 characters.");
    expect(sendButton(host)?.disabled).toBe(false);
    await clickSend(host);
    expect(portalCalls()).toHaveLength(1);
    expect(portalCalls()[0].p_body).toBe(emoji.repeat(3600));
  });

  it("keeps the email address known from earlier email when later messages are in the portal", async () => {
    // Maya emailed first; since then the conversation moved to the portal both ways. Her contact
    // record has no email, so the thread's own history is the only place the address is known.
    db.messages = [emailIn, portalIn, portalOut];
    db.threads = [thread("cust-user-1", "outbound", [])];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
    await chooseIdentity(host, /jordan@northlightadvisory/);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
    expect(host.textContent).toContain(`To ${MAYA_EMAIL}`);
    expect(host.textContent).not.toContain("No address on this thread");
  });

  it("never labels an email/SMS address as a Portal handle on a portal thread", async () => {
    // No email on the contact record, so the only address is the one from her earlier email.
    db.messages = [emailIn, portalIn, portalOut];
    db.threads = [thread("cust-user-1", "outbound", [])];
    const host = await mountInbox(path);
    // Not in the contact card as a "Portal" row, not in the thread header as "Portal · <address>".
    expect(host.querySelector('button[title="Copy Portal"]')).toBeNull();
    expect(host.textContent).not.toContain(`Portal · ${MAYA_EMAIL}`);
    expect(host.textContent).not.toContain(MAYA_EMAIL);
  });

  it("shows the signature toggle for email and never in portal mode", async () => {
    db.signatures = [{ id: "sig-1", user_id: "owner-1", name: "Jordan", html: "<p>Jordan</p>", variables: null, is_default: true }];
    db.messages = [portalIn, emailIn].map((m, i) => ({ ...m, sent_at: at(i + 1), created_at: at(i + 1) }));
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(signatureToggle(host)).toBeTruthy(); // email reply, signature configured → offered
    await chooseIdentity(host, /Client portal/);
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
    expect(signatureToggle(host)).toBeUndefined(); // a portal post never carries a signature
  });

  it("keeps a manually chosen Portal channel and the draft when a new message arrives in the thread", async () => {
    db.messages = [portalIn, emailIn].map((m, i) => ({ ...m, sent_at: at(i + 1), created_at: at(i + 1) }));
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
    await chooseIdentity(host, /Client portal/);
    await type(host, "Half-written portal reply");
    await messageArrives(host, { ...portalIn, id: "m-new-in", body_text: "One more thing!", sent_at: at(6), created_at: at(6) });
    expect(host.textContent).toContain("One more thing!");
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
    expect(composerBox(host).value).toBe("Half-written portal reply");
  });

  it("shows a customer's help request as a help request chip, not an email subject line", async () => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    const chip = host.querySelector("[data-portal-help-request]");
    expect(chip?.textContent?.trim()).toBe("Help request");
    expect(chip?.querySelector("svg.lucide-circle-help")).toBeTruthy();
    // The chip sits in the sender/meta line, next to the portal sender.
    expect(chip?.parentElement?.textContent).toContain("Portal · Maya Ortiz");
    // The server's "Help request" subject is not rendered as an email subject line.
    const subjectLines = Array.from(host.querySelectorAll("p")).filter((p) => (p.textContent ?? "").trim() === "Help request");
    expect(subjectLines).toHaveLength(0);
    expect(host.textContent).toContain("I can't find my invoice.");
  });

  it("keeps an email subject line on email and adds no help chip to ordinary portal messages", async () => {
    db.messages = [emailIn, portalIn];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(host.querySelector("[data-portal-help-request]")).toBeNull();
    const subjectLines = Array.from(host.querySelectorAll("p")).filter((p) => (p.textContent ?? "").trim() === "Spring planting");
    expect(subjectLines).toHaveLength(1);
  });

  it("does not default to Portal for a client who hasn't joined the portal", async () => {
    db.messages = [portalIn, portalHelp];
    db.threads = [thread(null)];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
    expect(host.textContent).not.toContain("Posts in Maya Ortiz's client portal");
    expect(host.querySelector("[data-portal-not-connected]")).toBeNull();
  });

  it("explains inline and holds Send when the owner picks Portal for a client who hasn't joined", async () => {
    db.messages = [portalIn, portalHelp];
    db.threads = [thread(null)];
    const host = await mountInbox(path);
    await chooseIdentity(host, /Client portal/);
    expect(composerBox(host).placeholder).toBe("Message Maya Ortiz in their client portal…");
    const notice = host.querySelector("[data-portal-not-connected]");
    expect(notice?.textContent).toContain("Maya Ortiz hasn't joined your client portal yet");
    // The footer must not promise a post the notice above says can't happen.
    expect(host.textContent).not.toContain("Posts in Maya Ortiz's client portal");
    await type(host, "Are you there?");
    expect(sendButton(host)?.disabled).toBe(true);
    await clickSend(host);
    expect(portalCalls()).toHaveLength(0);
    expect(composerBox(host).value).toBe("Are you there?");
    // Back on email, the notice goes and Send is the email send again.
    await chooseIdentity(host, /jordan@northlightadvisory/);
    expect(host.querySelector("[data-portal-not-connected]")).toBeNull();
  });

  // E09 Slice 7 (review HIGH-2): a paused client keeps their link. The portal channel must not
  // default, and choosing it explains the pause and holds Send, so nothing (and no notice) reaches them.
  it("holds a portal reply to a paused client and says how to restore it", async () => {
    db.messages = [portalIn, portalHelp];
    db.threads = [{ ...thread("cust-user-1"), clients: { ...client("cust-user-1"), portal_access_state: "paused" } }];
    const host = await mountInbox(path);
    expect(composerBox(host).placeholder).toBe("Reply to Maya Ortiz…  (drop a file to attach)");
    await chooseIdentity(host, /Client portal/);
    const notice = host.querySelector("[data-portal-not-connected]");
    expect(notice?.textContent).toContain("Maya Ortiz’s portal access is paused. Restore their portal access to message them here");
    await type(host, "Are you there?");
    expect(sendButton(host)?.disabled).toBe(true);
    await clickSend(host);
    expect(portalCalls()).toHaveLength(0);
  });

  // E09 Slice 7, verifier finding 3: web deployed before migration 20271110240000 — the inbox loads.
  it("still loads the inbox when the access column does not exist yet", async () => {
    db.premigration = true;
    db.messages = [portalIn, portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    expect(db.threadSelects.some((cols) => /portal_access_state/.test(cols))).toBe(true);
    expect(db.threadSelects.some((cols) => !/portal_access_state/.test(cols) && /linked_user_id/.test(cols))).toBe(true);
    expect(toast.error).not.toHaveBeenCalledWith("Couldn't load the inbox.");
    expect(composerBox(host)).toBeTruthy();
  });

  it("offers the connect-a-channel step, not a dead Portal composer, for an unjoined client with no email or SMS", async () => {
    db.connectors = [];
    db.messages = [portalHelp];
    db.threads = [thread(null)];
    const host = await mountInbox(path);
    expect(host.textContent).toContain("Connect a channel");
    expect(Array.from(host.querySelectorAll("textarea")).some((t) => /client portal/.test(t.placeholder))).toBe(false);
  });

  it("keeps the portal draft when a new message arrives in a portal conversation", async () => {
    db.messages = [portalHelp];
    db.threads = [thread("cust-user-1")];
    const host = await mountInbox(path);
    await type(host, "Looking into it");
    await messageArrives(host, { ...portalIn, id: "m-new-in", body_text: "Found it, never mind.", sent_at: at(6), created_at: at(6) });
    expect(host.textContent).toContain("Found it, never mind.");
    expect(composerBox(host).value).toBe("Looking into it");
  });
});
