/**
 * EXP03 O12 piece 3 — the Conversations email reply goes through the governed email door, with the
 * owner-approved inline check (option B (ii), 2026-10-27): Send CHECKS, the action row becomes the
 * check (server-resolved To and From, Subject, Files, When), and "Send now" / "Schedule send" spends
 * the single-use fingerprint. Nothing is sent on the check; the undo window is gone for email.
 *
 * Mounts the REAL inbox (ClientsConversations, the component Solo mounts at
 * /solo/:account/clients/conversations) with the database and the door stubbed.
 *
 * PROOF CLASS: rendered harness (jsdom) — the real component tree, a stubbed door. Not an
 * authenticated runtime drive, and not a browser render.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const OTHER_TENANT = "7a2b3c4d-5e6f-4a71-8b9c-0d1e2f3a4b5c";
const CONTACT = "0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5";
const CONN = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
const CONN_2 = "2e3f4a5b-6c7d-4e8f-9a01-b2c3d4e5f6a7";
const SMS_CONN = "3f4a5b6c-7d8e-4f90-8a12-c3d4e5f6a7b8";
const FP = "0123456789abcdef";

const db = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  signatures: [] as Array<Record<string, unknown>>,
  connectors: [] as Array<Record<string, unknown>>,
  invokes: [] as string[],
  sendBodies: [] as Array<Record<string, unknown>>,
  doorBodies: [] as Array<Record<string, unknown>>,
  /** Answers the door gives, in order; each takes the request body. Empty → a 202 check. */
  door: [] as Array<(body: Record<string, unknown>) => unknown>,
  cancellations: [] as string[],
  tenant: "",
  rpcTenant: "",
  reduce: true,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const rows = () => table === "messages" ? db.messages : table === "threads" ? db.threads
      : table === "channel_connectors" ? db.connectors : table === "signatures" ? db.signatures : [];
    const result = () => ({ data: rows(), error: null, count: rows().length });
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, key) {
        if (key === "then") return (ok: (v: unknown) => void) => ok(result());
        if (key === "single" || key === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
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
        if (name === "cancel_scheduled_message") { db.cancellations.push(args?._id ?? ""); return Promise.resolve({ data: true, error: null }); }
        return Promise.resolve({ data: name === "current_user_tenant_id" ? db.rpcTenant : [], error: null });
      },
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      functions: {
        invoke: (name: string, opts?: { body?: Record<string, unknown> }) => {
          db.invokes.push(name);
          const body = opts?.body ?? {};
          if (name === "comms-email-command") {
            db.doorBodies.push(structuredClone(body));
            const next = db.door.shift();
            return Promise.resolve(next ? next(body) : check202(body));
          }
          if (name === "send-message") { db.sendBodies.push(body); return Promise.resolve({ data: { outcome: "queued_scheduled", message_id: "queued-1" }, error: null }); }
          return Promise.resolve({ data: null, error: null });
        },
      },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), remove: () => Promise.resolve({ data: null, error: null }), createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  };
  function check202(body: Record<string, unknown>) {
    const command = body.command as Record<string, unknown>;
    return {
      data: {
        ok: false, outcome: "approval_required", capability: "comms_send_email", fingerprint: "0123456789abcdef", operation_id: body.operation_id,
        summary: "Email", expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        preview: {
          kind: "email", to_name: "Maya Ortiz", to_address: "maya.server@ortizlandscaping.example", from_address: "jordan@northlightadvisory.example",
          subject: command.subject, body_text: command.body,
          ...(body.send_at ? { send_at: body.send_at } : {}),
          ...(Array.isArray(body.attachments) ? { attachments: (body.attachments as Array<{ path: string }>).map((a, i) => ({ name: a.path.slice(a.path.indexOf("/") + 38), size: [48_000, 2_400_000][i] ?? 900, mime: "application/pdf" })) } : {}),
        },
      },
      error: null,
    };
  }
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
  useReducedMotion: () => db.reduce,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));

import ClientsConversations from "@/pages/admin/ClientsConversations";
import { toast } from "sonner";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const KEY = `contact:${TENANT}:${CONTACT}`;
const NOW = new Date().toISOString();
const client = {
  id: CONTACT, first_name: "Maya", last_name: "Ortiz", entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: null, source: null, tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: null, timezone: null, created_at: NOW, created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null, email: "maya@ortizlandscaping.example",
  client_contact_methods: [{ kind: "email", value: "maya@ortizlandscaping.example", is_primary: true }],
};
const message = (over: Record<string, unknown> = {}) => ({
  id: "m-1", thread_key: KEY, contact_id: CONTACT, connector_id: CONN, channel_type: "email",
  direction: "inbound", status: "received", sender: { address: "maya@ortizlandscaping.example" },
  recipients: [{ address: "jordan@northlightadvisory.example" }], subject: "Tuesday",
  body_text: "Could you send over what we agreed?", body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null, scheduled_for: null,
  sent_at: NOW, created_at: NOW, call_duration_seconds: null, recording_url: null, transcript: null,
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
  ...over,
});
const thread = { id: "t-1", thread_key: KEY, contact_id: CONTACT, snoozed_until: null, archived_at: null, labels: [], unread_count: 0, last_message_at: NOW, last_direction: "inbound", clients: client };
const emailConnector = (id: string, name: string, address: string) => ({ id, channel_type: "email", provider: "sendgrid", display_name: name, from_address: address, from_name: name, inbound_address: null, status: "active", active: true });

const answer = (data: unknown) => () => ({ data, error: null });
const httpError = (status: number, body: Record<string, unknown>) => () => ({ data: null, error: { name: "FunctionsHttpError", context: { status, json: async () => body } } });
const accepted = (over: Record<string, unknown> = {}) => (b: Record<string, unknown>) => ({ data: { ok: true, outcome: "provider_accepted", operation_id: b.operation_id, message_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", ...over }, error: null });

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await flush(); }); };

const mounted: Array<() => Promise<void>> = [];
let root: Root | null = null;
const tree = (path: string) => <MemoryRouter initialEntries={[path]}><ClientsConversations /></MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
  db.messages = [message()]; db.threads = [thread]; db.signatures = [];
  db.connectors = [emailConnector(CONN, "Northlight Advisory", "jordan@northlightadvisory.example")];
  db.invokes = []; db.sendBodies = []; db.doorBodies = []; db.door = []; db.cancellations = [];
  db.tenant = TENANT; db.rpcTenant = TENANT; db.reduce = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});
afterEach(async () => { while (mounted.length) await mounted.pop()!(); });

async function mount(path = "/solo/3855/clients/conversations") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  await act(async () => { r.render(tree(path)); await flush(); });
  await settle();
  mounted.push(async () => { await act(async () => { r.unmount(); }); host.remove(); });
  return host;
}

const textarea = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('[data-composer-writing-surface="true"] textarea')!;
const subjectInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[placeholder="Subject"]')!;
const sendButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-composer-send]");
const strip = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-governed-reply-strip]");
const stripButton = (host: HTMLElement, focus: string) => host.querySelector<HTMLButtonElement>(`[data-strip-focus="${focus}"]`);
const status = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-governed-reply-status]")?.textContent ?? "";
const buttonByText = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  });
}
async function write(host: HTMLElement, subject = "Thursday", body = "Following up on Thursday.") {
  await type(subjectInput(host), subject);
  await type(textarea(host), body);
}
async function click(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { el!.click(); await flush(); });
  await settle();
}
async function attach(host: HTMLElement, names: string[]) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = names.map((n) => new File(["%PDF-1.4"], n, { type: "application/pdf" }));
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await flush(); });
  await settle();
}
const stripText = (host: HTMLElement) => strip(host)?.textContent ?? "";

describe("Send on an email reply checks it with the governed door — nothing is sent on the check", () => {
  it("calls ONLY the door, with the exact words including the signature as text; Send says Checking…, stays focused", async () => {
    db.signatures = [{ id: "sig-1", user_id: "owner-1", name: "Main", html: "<p>Jordan Lee</p><p>Northlight Advisory</p>", variables: null, is_default: true }];
    let release!: (v: unknown) => void;
    db.door = [() => new Promise((r) => { release = () => r({ data: null, error: null }); })];
    const host = await mount();
    await write(host);
    const send = sendButton(host)!;
    send.focus();
    await act(async () => { send.click(); await flush(); });
    expect(db.invokes).toEqual(["comms-email-command"]);
    expect(db.sendBodies).toEqual([]);
    const body = db.doorBodies[0];
    expect(body).toEqual({
      expected_tenant_id: TENANT, operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      command: { action: "comms.email_send", contact_id: CONTACT, connector_id: CONN, subject: "Thursday", body: "Following up on Thursday.\n\n--\nJordan Lee\nNorthlight Advisory" },
    });
    expect(sendButton(host)!.textContent).toContain("Checking…");
    expect(sendButton(host)!.getAttribute("aria-busy")).toBe("true");
    expect(sendButton(host)!.getAttribute("aria-disabled")).toBe("true");
    expect(sendButton(host)!.disabled).toBe(false);
    expect(document.activeElement).toBe(sendButton(host));
    // A second click while checking asks nothing more.
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(db.doorBodies).toHaveLength(1);
    await act(async () => { release(null); await flush(); });
  });

  it("a 202 becomes the inline check: server To, gold Send now in place of the action row, focus on Send now, announced", async () => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    const s = strip(host)!;
    expect(s.getAttribute("role")).toBe("group");
    expect(s.getAttribute("aria-label")).toBe("Check before sending");
    expect(stripText(host)).toContain("ToMaya Ortiz · maya.server@ortizlandscaping.example");
    expect(stripText(host)).toContain("FromNorthlight Advisory · jordan@northlightadvisory.example");
    expect(stripText(host)).toContain("SubjectThursday");
    expect(stripText(host)).toContain("Nothing has been sent yet. Changing the words closes this check.");
    // The action row and the composer's gold Send are gone: gold appears once, on Send now.
    expect(sendButton(host)).toBeNull();
    expect(buttonByText(host, "Attach")).toBeUndefined();
    expect(buttonByText(host, "Draft with Paige")).toBeUndefined();
    expect(stripButton(host, "confirm")!.textContent).toBe("Send now");
    expect(document.activeElement).toBe(stripButton(host, "confirm"));
    expect(status(host)).toBe("Ready to send to Maya Ortiz. Check To and From, then Send now.");
    // The words stay editable above the check.
    expect(textarea(host).disabled).toBe(false);
  });

  it("Send now spends the fingerprint on the same operation; Accepted clears the reply, focuses it; a double click is one request", async () => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    let release!: (v: unknown) => void;
    db.door = [(b) => new Promise((r) => { release = () => r(accepted()(b)); })];
    const confirm = stripButton(host, "confirm")!;
    await act(async () => { confirm.click(); confirm.click(); await flush(); });
    expect(stripButton(host, "confirm")!.textContent).toBe("Sending…");
    expect(stripButton(host, "confirm")!.getAttribute("aria-busy")).toBe("true");
    expect(textarea(host).disabled).toBe(true);
    await act(async () => { stripButton(host, "confirm")!.click(); await flush(); });
    expect(db.doorBodies).toHaveLength(2);
    expect(db.doorBodies[1]).toEqual({ ...db.doorBodies[0], approved_fingerprint: FP });
    await act(async () => { release(null); await flush(); });
    await settle();
    expect(strip(host)).toBeNull();
    expect(textarea(host).value).toBe("");
    expect(subjectInput(host).value).toBe("");
    expect(document.activeElement).toBe(textarea(host));
    expect(status(host)).toBe("Accepted by the email service.");
    expect(db.sendBodies).toEqual([]);
  });

  it.each(["edit", "escape", "typing"])("closing the check (%s) sends nothing and keeps the words", async (how) => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(strip(host)).toBeTruthy();
    if (how === "edit") await click(stripButton(host, "edit"));
    if (how === "escape") {
      await act(async () => { stripButton(host, "confirm")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await flush(); });
      await settle();
    }
    if (how === "typing") { textarea(host).focus(); await type(textarea(host), "Following up on Thursday!"); }
    expect(strip(host)).toBeNull();
    expect(db.doorBodies).toHaveLength(1);
    expect(textarea(host).value).toBe(how === "typing" ? "Following up on Thursday!" : "Following up on Thursday.");
    expect(document.activeElement).toBe(textarea(host));
    if (how !== "typing") expect(textarea(host).selectionStart).toBe(textarea(host).value.length);
    expect(status(host)).toBe("Check closed. Nothing was sent.");
    expect(sendButton(host)).toBeTruthy();
  });

  it("Ctrl+Enter or plain Enter while the check is open never confirms it", async () => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    for (const init of [{ ctrlKey: true }, {}]) {
      await act(async () => { textarea(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })); await flush(); });
    }
    expect(db.doorBodies).toHaveLength(1);
    expect(strip(host)).toBeTruthy();
  });

  it("an expired check says so; Check again re-asks about the SAME operation", async () => {
    db.door = [(b) => {
      const r = { data: { ok: false, outcome: "approval_required", fingerprint: FP, operation_id: b.operation_id, expires_at: new Date(Date.now() + 5_400).toISOString(),
        preview: { kind: "email", to_name: "Maya Ortiz", to_address: "maya@ortizlandscaping.example", from_address: "jordan@northlightadvisory.example", subject: (b.command as { subject: string }).subject, body_text: (b.command as { body: string }).body } }, error: null };
      return r;
    }];
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(document.activeElement).toBe(stripButton(host, "confirm"));
    await act(async () => { await new Promise((r) => setTimeout(r, 650)); await flush(); });
    await settle();
    expect(stripText(host)).toContain("This check expired — check again.");
    expect(stripButton(host, "confirm")).toBeNull();
    expect(document.activeElement).toBe(stripButton(host, "recheck"));
    expect(status(host)).toBe("This check expired. Check again before sending.");
    await click(stripButton(host, "recheck"));
    expect(db.doorBodies).toHaveLength(2);
    expect(db.doorBodies[1]).toEqual(db.doorBodies[0]);
    expect(stripButton(host, "confirm")).toBeTruthy();
  });

  it("the same words reuse the operation id; changed words start a new one", async () => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    await click(stripButton(host, "edit"));
    await click(sendButton(host));
    expect(db.doorBodies[1].operation_id).toBe(db.doorBodies[0].operation_id);
    await type(textarea(host), "Following up on Friday.");
    await click(sendButton(host));
    expect(db.doorBodies[2].operation_id).not.toBe(db.doorBodies[0].operation_id);
  });
});

describe("files and a send time go through the check", () => {
  it("names the files in the order staged and shows each one's size in the check", async () => {
    const host = await mount();
    await write(host);
    await attach(host, ["proposal.pdf", "scope.pdf"]);
    await click(sendButton(host));
    const paths = (db.doorBodies[0].attachments as Array<{ path: string }>).map((a) => a.path);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^${TENANT}/[0-9a-f-]{36}-proposal\\.pdf$`));
    expect(paths[1]).toMatch(/-scope\.pdf$/);
    expect(stripText(host)).toContain("Filesproposal.pdf · 47 KB, scope.pdf · 2.3 MB");
  });

  it("a file the door would refuse makes no call and is named", async () => {
    const host = await mount();
    await write(host);
    const long = `${"a".repeat(124)}.pdf`;
    await attach(host, ["ok.pdf", long]);
    await click(sendButton(host));
    expect(db.doorBodies).toEqual([]);
    expect(stripText(host)).toContain(`${long} can't go with this email.`);
    expect(stripText(host)).toContain("Your words are kept.");
  });

  it("a scheduled email sends a whole-minute time, reads When Sends …, and its act is Schedule send", async () => {
    const host = await mount();
    await write(host);
    const at = new Date(Date.now() + 3 * 3600_000 + 37_500);
    await act(async () => { buttonByText(host, "Schedule")!.click(); await flush(); });
    const custom = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    // The popover's Custom field: drive it with a local time string.
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(custom!, local);
      custom!.dispatchEvent(new Event("input", { bubbles: true })); custom!.dispatchEvent(new Event("change", { bubbles: true })); await flush();
    });
    await settle();
    await click(sendButton(host));
    const sendAt = db.doorBodies[0].send_at as string;
    expect(sendAt).toMatch(/:00\.000Z$/);
    expect(Date.parse(sendAt) % 60_000).toBe(0);
    const label = new Date(sendAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(stripText(host)).toContain(`WhenSends ${label}`);
    expect(stripButton(host, "confirm")!.textContent).toBe("Schedule send");
    expect(status(host)).toBe("Ready to send to Maya Ortiz. Check To and From, then Schedule send.");
  });

  it("a time too soon is caught before any call", async () => {
    const host = await mount();
    await write(host);
    await act(async () => { buttonByText(host, "Schedule")!.click(); await flush(); });
    const custom = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    const at = new Date(Date.now() + 70_000);
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(custom, local);
      custom.dispatchEvent(new Event("input", { bubbles: true })); custom.dispatchEvent(new Event("change", { bubbles: true })); await flush();
    });
    await settle();
    await click(sendButton(host));
    expect(db.doorBodies).toEqual([]);
    expect(stripText(host)).toContain("That time is too soon.");
  });
});

describe("the sender choice", () => {
  it("picking a sender runs the check again with that sender", async () => {
    db.connectors = [emailConnector(CONN, "Northlight Advisory", "jordan@northlightadvisory.example"), emailConnector(CONN_2, "Jordan (personal)", "jordan.lee@personal.example")];
    db.door = [httpError(409, { ok: false, outcome: "sender_choice_required", reason: "SENDER_CHOICE_REQUIRED", senders: [{ connector_id: CONN, from_address: "jordan@northlightadvisory.example" }, { connector_id: CONN_2, from_address: "jordan.lee@personal.example" }] })];
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(strip(host)!.getAttribute("aria-label")).toBe("Pick who this comes from");
    expect(document.activeElement).toBe(stripButton(host, "first-option"));
    const second = [...strip(host)!.querySelectorAll("button")].find((b) => b.textContent?.includes("jordan.lee@personal.example"));
    await click(second);
    expect(db.doorBodies).toHaveLength(2);
    expect((db.doorBodies[1].command as { connector_id: string }).connector_id).toBe(CONN_2);
    expect(stripButton(host, "confirm")).toBeTruthy();
  });
});

describe("every refusal reads in owner words, and the words are kept", () => {
  const rows: Array<[string, () => unknown, string]> = [
    ["no email on the card", httpError(422, { ok: false, outcome: "needs_setup", reason: "RECIPIENT_EMAIL_MISSING" }), "There's no email address on Maya Ortiz's contact card. Add one, then send."],
    ["sender not verified", httpError(422, { ok: false, outcome: "needs_setup", reason: "SENDER_VERIFICATION_MISSING" }), "jordan@northlightadvisory.example isn't verified for sending. Finish it in Settings → Email, then send."],
    ["sender missing", httpError(422, { ok: false, outcome: "needs_setup", reason: "TENANT_EMAIL_SENDER_MISSING" }), "This sending address can't send email. Choose another."],
    ["reconnect", httpError(422, { ok: false, outcome: "needs_setup", reason: "EMAIL_RECONNECT_REQUIRED" }), "Reconnect jordan@northlightadvisory.example, then send."],
    ["provider off", httpError(422, { ok: false, outcome: "needs_setup", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }), "Email sending isn't switched on for this business yet."],
    ["suppressed", httpError(422, { ok: false, outcome: "refused", reason: "BLOCKED_SUPPRESSED" }), "Can't send to Maya Ortiz. They unsubscribed or this address bounced."],
    ["no consent", httpError(422, { ok: false, outcome: "refused", reason: "BLOCKED_NO_CONSENT" }), "Can't send to Maya Ortiz. This person hasn't agreed to get email from you."],
    ["client dnd", httpError(422, { ok: false, outcome: "refused", reason: "BLOCKED_CLIENT_DND" }), "Can't send to Maya Ortiz. This person asked not to be contacted right now."],
    ["not a contact", httpError(422, { ok: false, outcome: "refused", reason: "CONTACT_NOT_IN_WORKSPACE" }), "This person isn't a contact in this business."],
    ["quiet hours", httpError(422, { ok: false, outcome: "held", reason: "QUEUED_QUIET_HOURS" }), "It can't go out right now — it's quiet hours. Schedule it for later."],
    ["business dnd", httpError(422, { ok: false, outcome: "held", reason: "QUEUED_TENANT_DND" }), "It can't go out right now — Do not disturb is on. Schedule it for later."],
    ["preferences unverified", httpError(422, { ok: false, outcome: "held", reason: "RECIPIENT_PREFERENCES_UNVERIFIED" }), "Couldn't check just now. Nothing was sent."],
    ["readiness unverified", httpError(422, { ok: false, outcome: "refused", reason: "EMAIL_READINESS_UNVERIFIED" }), "Couldn't check just now. Nothing was sent."],
    ["files need PAIGE Email", httpError(422, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED" }), "Files only go from a PAIGE Email address."],
    ["file type", httpError(422, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED" }), "One of these files is a type email can't carry. Remove it, then send."],
    ["file too large", httpError(422, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENT_TOO_LARGE" }), "A file is over 10 MB. Remove it, then send."],
    ["file empty", httpError(422, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENT_EMPTY" }), "One of these files is empty. Remove it and attach it again."],
    ["files invalid", httpError(400, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENTS_INVALID" }), "These files can't go with this email. Remove them and attach them again."],
    ["files unreadable", httpError(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" }), "Couldn't read the files just now. Nothing was sent."],
    ["member seat", httpError(403, { ok: false, outcome: "refused", code: "COMMS_EMAIL_FORBIDDEN" }), "Only an owner or admin sends email for the business."],
    ["sending paused", httpError(403, { ok: false, outcome: "refused", code: "COMMS_PROVIDER_EXECUTION_DISABLED" }), "Sending is paused for this business."],
    ["decision refused", httpError(403, { ok: false, outcome: "refused", code: "autonomy_off", message: "This action is turned off for this workspace." }), "This email can't be sent from here right now."],
    ["other tab", httpError(409, { ok: false, outcome: "refused", code: "WORKSPACE_CHANGED" }), "You switched business in another tab. Reopen this one, then send."],
    ["signed out", httpError(401, { ok: false, outcome: "refused", code: "UNAUTHENTICATED" }), "You've been signed out."],
    ["parties unavailable", httpError(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_PARTIES_UNAVAILABLE" }), "Couldn't check just now. Nothing was sent."],
    ["reconciliation", httpError(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_RECONCILIATION_UNVERIFIED" }), "Couldn't check just now. Nothing was sent."],
    ["approval store", httpError(503, { ok: false, outcome: "refused", code: "APPROVAL_STORE_UNAVAILABLE" }), "Couldn't check just now. Nothing was sent."],
    ["authority", httpError(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_AUTHORITY_UNAVAILABLE" }), "Couldn't check just now. Nothing was sent."],
    ["receipt", httpError(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_DECISION_RECEIPT_FAILED" }), "Couldn't check just now. Nothing was sent."],
    ["identical in flight", httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT" }), "The same email to Maya Ortiz is still going out from an earlier send — don't send it again."],
    ["teammate in flight", httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_TEAMMATE_IN_FLIGHT" }), "A teammate is already sending this exact email."],
    ["replay unavailable", httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }), "Couldn't confirm whether this went out — don't resend."],
    ["release unsettled", httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_SCHEDULED_RELEASE_UNSETTLED" }), "Couldn't confirm whether this went out — don't resend."],
    ["a refused replay", httpError(422, { ok: false, outcome: "refused", reason: "BLOCKED_SUPPRESSED", replayed: true }), "Can't send to Maya Ortiz. They unsubscribed or this address bounced."],
    ["a failed replay", httpError(422, { ok: false, outcome: "failed", reason: "SENDGRID_400", replayed: true }), "This email didn't go out last time."],
  ];
  it.each(rows)("%s", async (_name, door, copy) => {
    db.door = [door];
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(db.sendBodies).toEqual([]);
    expect(strip(host)).toBeTruthy();
    expect(stripText(host).replace(/\s+/g, " ")).toContain(copy);
    // No code ever reaches the screen.
    expect(stripText(host)).not.toMatch(/[A-Z_]{6,}/);
    expect(stripButton(host, "confirm")).toBeNull();
    expect(textarea(host).value).toBe("Following up on Thursday.");
    expect(subjectInput(host).value).toBe("Thursday");
    expect(document.activeElement).toBe(stripButton(host, "edit"));
    if (/unknown|IN_FLIGHT|UNSETTLED/.test(JSON.stringify(door))) expect(stripButton(host, "recheck")).toBeNull();
  });

  it("the unverified sender offers the way to fix it", async () => {
    db.door = [httpError(422, { ok: false, outcome: "needs_setup", reason: "SENDER_VERIFICATION_MISSING" })];
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    const link = [...strip(host)!.querySelectorAll("a")].find((a) => a.textContent === "Open email settings");
    expect(link?.getAttribute("href")).toMatch(/settings|connections/i);
  });

  it("a check answered with an earlier send already accepted clears the reply and says so (a replay)", async () => {
    db.door = [accepted({ replayed: true })];
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(strip(host)).toBeNull();
    expect(textarea(host).value).toBe("");
    expect(status(host)).toBe("Already sent. Accepted by the email service.");
  });
});

describe("the confirm's answers", () => {
  async function toCheck(next: () => unknown) {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    db.door = [next];
    await click(stripButton(host, "confirm"));
    return host;
  }
  it("an unknown outcome clears the reply (it may have gone out), with no retry offered", async () => {
    const host = await toCheck(httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" }));
    expect(strip(host)).toBeNull();
    expect(textarea(host).value).toBe("");
    expect(status(host)).toBe("Couldn't confirm this went out. Don't resend.");
    expect(db.doorBodies).toHaveLength(2);
  });
  it.each([
    [409, "COMMS_EMAIL_ATTACHMENTS_CHANGED", "A file changed after the check."],
    [409, "COMMS_EMAIL_SEND_AT_PASSED", "That time is too close now. Pick a new time."],
    [409, "WORKSPACE_CHANGED", "You switched business in another tab."],
    [422, "RECIPIENT_CHANGED", "Maya Ortiz's email address changed since the check."],
    [422, "SENDER_CHANGED", "The sending address changed since the check."],
    [422, "CONTENT_CHANGED", "The email changed since the check."],
    [422, "SEND_NOT_ADMITTED", "It didn't go out. Check again to send it."],
  ])("%s %s keeps the words and says why", async (statusCode, code, copy) => {
    const host = await toCheck(httpError(statusCode, { ok: false, outcome: "refused", code, reason: code }));
    expect(stripText(host).replace(/\s+/g, " ")).toContain(copy);
    expect(textarea(host).value).toBe("Following up on Thursday.");
    expect(stripText(host)).not.toMatch(/[A-Z_]{6,}/);
  });
  it("a 202 on the confirm is a fresh check to confirm again", async () => {
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    await click(stripButton(host, "confirm")); // an empty door queue answers 202 again
    expect(stripButton(host, "confirm")).toBeTruthy();
    expect(status(host)).toBe("Checked again — confirm with Send now.");
  });
  it("a lost answer keeps the words, says don't resend, and Check status re-asks the same operation without a fingerprint", async () => {
    const host = await toCheck(() => ({ data: null, error: { name: "FunctionsFetchError", context: new Error("network") } }));
    expect(stripText(host)).toContain("Couldn't confirm this went out — don't resend.");
    expect(textarea(host).value).toBe("Following up on Thursday.");
    db.door = [accepted({ replayed: true })];
    await click(buttonByText(host, "Check status"));
    expect(db.doorBodies).toHaveLength(3);
    const { approved_fingerprint: _fp, ...withoutFp } = db.doorBodies[1];
    expect(db.doorBodies[2]).toEqual(withoutFp);
    expect(textarea(host).value).toBe("");
    expect(status(host)).toBe("Already sent. Accepted by the email service.");
  });
});

describe("checks that never reach the door", () => {
  it("offline: no call, the offline strip with Try again", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(db.doorBodies).toEqual([]);
    expect(stripText(host)).toContain("Can't check right now. You're offline.");
    expect(buttonByText(host, "Try again")).toBeTruthy();
  });
  it("no contact on the thread: no call, asks for the contact first", async () => {
    const loose = { ...thread, contact_id: null, clients: null, thread_key: "email:loose@x.example" };
    db.threads = [loose];
    db.messages = [message({ thread_key: loose.thread_key, contact_id: null, sender: { address: "loose@x.example", display_name: "Sam Reed" } })];
    const host = await mount("/admin/clients/conversations");
    await write(host);
    await click(buttonByText(host, "Send"));
    expect(db.doorBodies).toEqual([]);
    expect(db.sendBodies).toEqual([]);
    expect(stripText(host)).toMatch(/as a contact first/);
  });
  it("a session pointing at another business: no call, Reopen this business", async () => {
    db.rpcTenant = OTHER_TENANT;
    const host = await mount();
    await write(host);
    await click(sendButton(host));
    expect(db.doorBodies).toEqual([]);
    expect(stripText(host)).toContain("Reopen this business, then send.");
  });
  it("a business switch while the check is out drops its late answer", async () => {
    let release!: (v: unknown) => void;
    db.door = [(b) => new Promise((r) => { release = () => r({ data: { ok: false, outcome: "approval_required", fingerprint: FP, operation_id: b.operation_id, expires_at: new Date(Date.now() + 600_000).toISOString(), preview: { to_address: "x@y.example", from_address: "a@b.example", subject: "Thursday", body_text: "Following up on Thursday." } }, error: null }); })];
    const host = await mount();
    await write(host);
    await act(async () => { sendButton(host)!.click(); await flush(); });
    db.tenant = OTHER_TENANT; db.rpcTenant = OTHER_TENANT; db.messages = []; db.threads = [];
    await act(async () => { root!.render(tree("/solo/3855/clients/conversations")); await flush(); });
    await settle();
    await act(async () => { release(null); await flush(); });
    await settle();
    expect(strip(host)).toBeNull();
    expect(status(host)).not.toMatch(/Ready to send/);
  });
});

describe("motion", () => {
  it("reduced motion: the check is at rest (no entrance) and Checking… shows a still clock", async () => {
    db.reduce = true;
    let release!: (v: unknown) => void;
    db.door = [() => new Promise((r) => { release = () => r({ data: null, error: null }); })];
    const host = await mount();
    await write(host);
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(sendButton(host)!.querySelector(".animate-spin")).toBeNull();
    expect(sendButton(host)!.querySelector(".lucide-clock")).toBeTruthy();
    await act(async () => { release(null); await flush(); });
  });
  it("full motion: the check enters from a 4px rise and opacity 0; Checking… spins", async () => {
    db.reduce = false;
    const host = await mount();
    await write(host);
    let release!: (v: unknown) => void;
    db.door = [(b) => new Promise((r) => { release = () => r({ data: { ok: false, outcome: "approval_required", fingerprint: FP, operation_id: b.operation_id, expires_at: new Date(Date.now() + 600_000).toISOString(), preview: { kind: "email", to_name: "Maya Ortiz", to_address: "maya@ortizlandscaping.example", from_address: "jordan@northlightadvisory.example", subject: "Thursday", body_text: "Following up on Thursday." } }, error: null }); })];
    await act(async () => { sendButton(host)!.click(); await flush(); });
    expect(sendButton(host)!.querySelector(".animate-spin")).toBeTruthy();
    await act(async () => { release(null); await flush(); });
    expect(strip(host)!.getAttribute("style") ?? "").toMatch(/opacity|transform/);
  });
});

describe("everything else keeps its own path", () => {
  it("an SMS reply still queues through send-message with the undo window", async () => {
    const SMS_KEY = `contact:${TENANT}:${CONTACT}`;
    db.connectors = [{ id: SMS_CONN, channel_type: "sms", provider: "twilio", display_name: "Business line", from_address: "+14045550138", from_name: null, inbound_address: null, status: "active", active: true }];
    db.messages = [message({ thread_key: SMS_KEY, channel_type: "sms", connector_id: SMS_CONN, subject: null })];
    const host = await mount();
    await type(textarea(host), "See you Thursday.");
    await click(sendButton(host));
    expect(db.invokes).toEqual(["send-message"]);
    expect(db.doorBodies).toEqual([]);
    expect(db.sendBodies[0]).toMatchObject({ channel: "sms", connector_id: SMS_CONN });
    expect(vi.mocked(toast).mock.calls.some(([, o]) => (o as { action?: { label?: string } } | undefined)?.action?.label === "Undo")).toBe(true);
  });
  it("Approve & send on a Paige draft, and Send edited, stay on send-message", async () => {
    db.messages = [message(), message({ id: "d-1", direction: "outbound", status: "draft", subject: "Re: Tuesday", body_text: "Here is the summary." })];
    const host = await mount("/admin/clients/conversations");
    await click(buttonByText(host, "Approve & send"));
    expect(db.invokes).toEqual(["send-message"]);
    expect(db.sendBodies[0]).toMatchObject({ message_id: "d-1" });
    await click(buttonByText(host, "Edit"));
    await click(buttonByText(host, "Send edited"));
    expect(db.invokes).toEqual(["send-message", "send-message"]);
    expect(db.sendBodies[1]).toMatchObject({ message_id: "d-1", channel: "email" });
    expect(db.doorBodies).toEqual([]);
  });
});
