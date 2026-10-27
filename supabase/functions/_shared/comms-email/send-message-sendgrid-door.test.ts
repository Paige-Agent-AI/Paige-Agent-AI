import { decideContentRead } from "../inbox-intelligence/policy.ts";
// Experience 03 · S3 — security H2: PAIGE Email (SendGrid) sends ONLY as the governed email door's
// dispatch. The REAL send-message handler is transpiled and executed with only its imports and the
// network substituted (send-message-sendgrid.test.ts technique). `fetch` is a stub that records every
// call: no HTTP request leaves this process and no provider is called.
//
// Proves: a SendGrid connector named by a user's generic send, by a service-role send that names no
// prepared comms_email operation, or by a scheduled release is refused with
// `paige_email_requires_governed_send` BEFORE any provider call (zero fetches), while a Resend
// connector on the identical request still reaches its provider (the gate is SendGrid-only).
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../comms-provider-boundary.ts";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { senderDisplayName } from "../email/sender-display-name.ts";
import { isPreparedAgreementMessage } from "../agreements/prepared-signature-message.ts";
import { tenantFrom, PLATFORM_FROM_DOMAIN } from "../email/platform-sendgrid.ts";

const MSG = "33333333-3333-4333-8333-3333333333bb";
const TENANT = "44444444-4444-4444-8444-4444444444bb";
const CONTACT = "55555555-5555-4555-8555-5555555555bb";
const CONNECTOR = "66666666-6666-4666-8666-6666666666bb";
const ACTOR = "77777777-7777-4777-8777-7777777777bb";
const SERVICE = "internal-service-key";

const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Caller = "user" | "service";
function setup(opts: { provider?: string; caller?: Caller; queued?: boolean; answer?: number | "throw" } = {}) {
  const provider = opts.provider ?? "sendgrid";
  const rpcCalls: string[] = [];
  const fetchCalls: string[] = [];
  const fetchBodies: Record<string, unknown>[] = [];
  const writes: { table: string; mode: string; values: unknown }[] = [];
  const adapters: Record<string, { send: (...a: unknown[]) => Promise<unknown> }> = {};
  let handler: (req: Request) => Promise<Response>;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ACTOR } } }) },
    from: (table: string) => {
      let mode = "select";
      const q: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order", "select", "limit", "gte", "lte"]) q[m] = () => q;
      for (const m of ["insert", "upsert", "update"]) q[m] = (values: unknown) => { mode = m; writes.push({ table, mode: m, values }); return q; };
      const result = () => {
        if (mode !== "select") return { data: { id: table === "messages" ? MSG : "row-id" }, error: null };
        if (table === "messages") return { data: { tenant_id: TENANT, status: opts.queued ? "queued" : "draft", connector_id: CONNECTOR, contact_id: CONTACT, thread_key: `contact:${TENANT}:${CONTACT}`, channel_type: "email", meta: { scheduled_binding: { contact_id: CONTACT, connector_id: CONNECTOR } } }, error: null };
        if (table === "clients") return { data: { tenant_id: TENANT, emails: ["lead@example.test"] }, error: null };
        if (table === "channel_connectors") return { data: { tenant_id: TENANT, status: "active", active: true, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider, from_address: "hello@someone-elses.example.test", from_name: "Spoof", reply_to: null, credentials_vault_ref: null, config: null }, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => result();
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "comms_provider_execution_allowed" || name === "has_role") return { data: true, error: null };
      if (name === "current_user_tenant_id") return { data: TENANT, error: null };
      if (name === "is_platform_owner") return { data: false, error: null };
      return { data: null, error: null };
    },
  };
  const fetchMock = (url: string, init?: { body?: string }) => {
    fetchCalls.push(url);
    fetchBodies.push(init?.body ? JSON.parse(init.body) : {});
    if (opts.answer === "throw") return Promise.reject(new TypeError("socket hang up"));
    if (typeof opts.answer === "number") return Promise.resolve(new Response("{\"errors\":[]}", { status: opts.answer }));
    return Promise.resolve(new Response(JSON.stringify({ id: "provider-id" }), { status: url.includes("sendgrid") ? 202 : 200, headers: { "X-Message-Id": "sg-id" } }));
  };
  const scope = { decideContentRead, commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED, PAIGE_APP_ORIGIN: "https://app.example.test",isPreparedAgreementMessage, tenantFrom, PLATFORM_FROM_DOMAIN,
    Deno: {
      env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE : k === "SENDGRID_MAIL_SEND_API_KEY" ? "SG.platform-key" : k === "RESEND_API_KEY" ? undefined : k === "SUPABASE_URL" ? "https://proj.example.test" : "configured" },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => client,
    registerOutboundAdapter: (a: { channel_type: string; send: (...x: unknown[]) => Promise<unknown> }) => { adapters[a.channel_type] = a; },
    getOutboundAdapter: (channel: string) => adapters[channel],
    buildListUnsubscribeHeaders: () => ({}),
    senderDisplayName,
    runPreSend: async () => ({ proceed: true, outcome: "proceed" }),
    CLIENT_CONTACT_METHODS_EMBED: "client_contact_methods",
    clientAddresses: (row: { emails?: string[] }) => ({ emails: row.emails ?? [], phones: [] }),
    readInvoiceDeliveryReadiness: async () => { throw new Error("invoice readiness reached"); },
    parseDeliveryBinding: () => { throw new Error("invoice binding parser reached"); },
    fetch: fetchMock,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (body: Record<string, unknown>) => {
    const res = await handler!(new Request("https://example.test/send-message", {
      method: "POST", headers: { Authorization: `Bearer ${opts.caller === "service" ? SERVICE : "user-jwt"}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { request, rpcCalls, fetchCalls, fetchBodies, writes };
}

const generic = { channel: "email", to: "lead@example.test", contact_id: CONTACT, connector_id: CONNECTOR, subject: "Hi", body: "<p>Hi</p>" };

describe("send-message refuses PAIGE Email (SendGrid) outside the governed email door", () => {
  it("a workspace admin's generic send through a SendGrid connector → refused, zero provider calls", async () => {
    const s = setup({ caller: "user" });
    const r = await s.request(generic);
    expect(s.fetchCalls).toEqual([]);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ outcome: "refused", error: "paige_email_requires_governed_send" });
    expect(JSON.stringify(r.body)).not.toMatch(/sendgrid/i);
  });

  it("a service-role send that names no prepared comms_email operation → refused, zero provider calls", async () => {
    const s = setup({ caller: "service" });
    const r = await s.request({ ...generic, idempotency_key: "anything" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls).toEqual([]);
    expect(s.rpcCalls).not.toContain("claim_comms_email_send");
  });

  it("a scheduled release through a SendGrid connector is terminalized for review, never sent", async () => {
    const s = setup({ caller: "service", queued: true });
    const r = await s.request({ ...generic, message_id: MSG });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls).toEqual([]);
    expect(s.writes.some((w) => w.table === "messages" && w.mode === "update" && (w.values as { status?: string }).status === "failed")).toBe(true);
  });

  it("control: the identical generic request through a managed (\"resend\") connector is not refused, and goes through SendGrid", async () => {
    // Experience 03: Resend is never called. The H2 refusal is for a SendGrid CONNECTOR outside the door;
    // a managed sender is sent through SendGrid with its From decided by tenantFrom.
    const s = setup({ caller: "user", provider: "resend" });
    const r = await s.request(generic);
    expect(r.body.error).not.toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls.length).toBe(1);
    expect(s.fetchCalls[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    // H2: the connector names a domain this business never verified; SendGrid would accept it on the
    // shared account, so it is never the From. The email goes as notifications@ under the sender's name.
    expect(s.fetchBodies[0].from).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Spoof" });
    expect(JSON.stringify(s.fetchBodies[0].from)).not.toContain("someone-elses");
  });
});

// Experience 03: SendGrid has no idempotent replay, so an ordinary email whose answer was lost (5xx, a
// thrown request) may already be in the client's inbox. send-message must say so — never a plain
// "failed" a caller or a person would resend — and its rows must not record a definitive failure.
describe("an ordinary SendGrid send whose answer could not be read", () => {
  const audit = (s: ReturnType<typeof setup>) => s.writes.find((w) => w.table === "paige_messages_audit")?.values as Record<string, unknown>;
  const messageWrites = (s: ReturnType<typeof setup>) => s.writes.filter((w) => w.table === "messages").map((w) => ({ mode: w.mode, ...(w.values as Record<string, unknown>) }));

  it.each([503, 500, "throw"] as const)("a direct send answered %s → outcome_unknown + unconfirmed; the thread records it as unconfirmed", async (answer) => {
    const s = setup({ caller: "user", provider: "resend", answer });
    const r = await s.request(generic);
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
    expect(r.body).toMatchObject({ status: "failed", outcome: "outcome_unknown", unconfirmed: true });
    expect(String(audit(s).error)).toMatch(/^delivery_unconfirmed: /);
    expect(messageWrites(s)).toEqual([expect.objectContaining({ mode: "insert", status: "failed", error: "delivery_unconfirmed", provider_message_id: null })]);
  });

  it("a scheduled release answered 503 → the released row is marked unconfirmed, not a plain failure", async () => {
    const s = setup({ caller: "service", provider: "resend", queued: true, answer: 503 });
    const r = await s.request({ ...generic, message_id: MSG });
    expect(r.body).toMatchObject({ outcome: "outcome_unknown", unconfirmed: true });
    expect(messageWrites(s)).toEqual([expect.objectContaining({ mode: "update", status: "failed", error: "delivery_unconfirmed" })]);
  });

  it("a definitive 4xx stays a plain failure: no unconfirmed marker, no thread row (unchanged)", async () => {
    const s = setup({ caller: "user", provider: "resend", answer: 400 });
    const r = await s.request(generic);
    expect(r.body).toMatchObject({ status: "failed", outcome: "failed" });
    expect(r.body).not.toHaveProperty("unconfirmed");
    expect(String(audit(s).error)).toMatch(/^sendgrid_400/);
    expect(messageWrites(s)).toEqual([]);
  });

  it("Gmail keeps its own answer (unchanged): a Gmail failure is never marked unconfirmed by this rule", async () => {
    const s = setup({ caller: "user", provider: "gmail", answer: 503 });
    const r = await s.request(generic);
    expect(r.body).not.toHaveProperty("unconfirmed");
    expect(r.body.outcome).not.toBe("outcome_unknown");
  });
});
