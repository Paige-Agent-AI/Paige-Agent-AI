// @vitest-environment node
// EXP03 — an approved campaign email may ride PAIGE Email (SendGrid) only as the database admits it
// (email_campaign_sendgrid_admit, migration 20271116020000). The REAL send-message handler is
// transpiled and executed with only its imports and the network substituted (the
// send-message-sendgrid-door.test.ts technique): `fetch` is a stub that records every call, so no HTTP
// request leaves this process and no provider is called.
//
// Proves: the worker's campaign send (service role, marketing, `ecr:<recipient id>`) reaches SendGrid
// exactly once, carrying the business and recipient ids SendGrid echoes on its events, and only when
// the database admits it for this business; every other shape is still refused before any provider
// call. An unreadable SendGrid answer is reported outcome_unknown (never failed), so the worker never
// sends that email again; only a 4xx is a definitive failure.
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../../supabase/functions/_shared/comms-provider-boundary.ts";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { senderDisplayName } from "../../supabase/functions/_shared/email/sender-display-name.ts";
import { isPreparedAgreementMessage } from "../../supabase/functions/_shared/agreements/prepared-signature-message.ts";
import { decideContentRead } from "../../supabase/functions/_shared/inbox-intelligence/policy.ts";
import { mapSendResult } from "../../supabase/functions/email-campaign-worker/logic.ts";

const TENANT = "44444444-4444-4444-8444-4444444444cc";
const OTHER_TENANT = "44444444-4444-4444-8444-4444444444dd";
const CONTACT = "55555555-5555-4555-8555-5555555555cc";
const CONNECTOR = "66666666-6666-4666-8666-6666666666cc";
const RECIPIENT = "88888888-8888-4888-8888-8888888888cc";
const SERVICE = "internal-service-key";

const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Admit = { data: unknown; error: unknown };
type Provider = "accept" | "throw" | 500 | 400;
function setup(opts: { caller?: "user" | "service"; admit?: Admit; provider?: Provider } = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const fetchCalls: { url: string; body: Record<string, unknown> }[] = [];
  const adapters: Record<string, { send: (...a: unknown[]) => Promise<unknown> }> = {};
  let handler: (req: Request) => Promise<Response>;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "77777777-7777-4777-8777-7777777777cc" } } }) },
    from: (table: string) => {
      let mode = "select";
      const q: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order", "select", "limit", "gte", "lte"]) q[m] = () => q;
      for (const m of ["insert", "upsert", "update"]) q[m] = () => { mode = m; return q; };
      const result = () => {
        if (mode !== "select") return { data: { id: "row-id" }, error: null };
        if (table === "clients") return { data: { tenant_id: TENANT, emails: ["lead@example.test"] }, error: null };
        if (table === "channel_connectors") return { data: { tenant_id: TENANT, status: "active", active: true, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: "sendgrid", from_address: "news@cedar.example.test", from_name: "Cedar", reply_to: null, credentials_vault_ref: null, config: null }, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => result();
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "email_campaign_sendgrid_admit") return opts.admit ?? { data: { ok: true, tenant_id: TENANT, recipient_id: RECIPIENT }, error: null };
      if (name === "comms_provider_execution_allowed" || name === "has_role") return { data: true, error: null };
      if (name === "current_user_tenant_id") return { data: TENANT, error: null };
      if (name === "is_platform_owner") return { data: false, error: null };
      if (name === "tenant_sender_identity") return { data: { from_name: "Cedar", from_address: "hello@managed.example.test" }, error: null };
      return { data: null, error: null };
    },
  };
  const fetchMock = (url: string, init?: { body?: string }) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
    if (opts.provider === "throw") return Promise.reject(new Error("socket hang up"));
    if (typeof opts.provider === "number") return Promise.resolve(new Response("{\"errors\":[]}", { status: opts.provider }));
    return Promise.resolve(new Response(null, { status: 202, headers: { "X-Message-Id": "sgCampaign1" } }));
  };
  const scope = { decideContentRead, commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED, PAIGE_APP_ORIGIN: "https://app.example.test", isPreparedAgreementMessage,
    Deno: {
      env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE : k === "SENDGRID_MAIL_SEND_API_KEY" ? "SG.platform-key" : k === "RESEND_API_KEY" ? "re_key" : k === "SUPABASE_URL" ? "https://proj.example.test" : "configured" },
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
      method: "POST", headers: { Authorization: `Bearer ${opts.caller === "user" ? "user-jwt" : SERVICE}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const sendgridCalls = () => fetchCalls.filter((c) => c.url.includes("api.sendgrid.com"));
  const admitCalls = () => rpcCalls.filter((c) => c.name === "email_campaign_sendgrid_admit");
  return { request, sendgridCalls, admitCalls };
}

// Exactly what email-campaign-worker sends (sendOne).
const campaign = {
  channel: "email", to: "lead@example.test", subject: "Spring at Cedar",
  body: "<p>Hello.</p><a href=\"{{unsubscribe_url}}\">Unsubscribe</a>",
  contact_id: CONTACT, connector_id: CONNECTOR, marketing: true, idempotency_key: `ecr:${RECIPIENT}`,
};
const refused = (r: { status: number; body: Record<string, unknown> }) =>
  r.status === 403 && r.body.error === "paige_email_requires_governed_send";

describe("send-message admits an approved campaign email to SendGrid only as the database says", () => {
  it("the worker's campaign send reaches SendGrid once, carrying the business and recipient ids", async () => {
    const s = setup();
    const r = await s.request(campaign);
    expect(s.admitCalls()).toEqual([{ name: "email_campaign_sendgrid_admit",
      args: { p_recipient_id: RECIPIENT, p_connector_id: CONNECTOR, p_to: "lead@example.test" } }]);
    expect(s.sendgridCalls().length).toBe(1);
    expect(s.sendgridCalls()[0].body.custom_args).toEqual({ paige_tenant_id: TENANT, paige_operation_id: RECIPIENT, paige_message_id: RECIPIENT });
    expect(s.sendgridCalls()[0].body.tracking_settings).toEqual({ open_tracking: { enable: true }, click_tracking: { enable: true, enable_text: false } });
    expect(r.body).toMatchObject({ status: "sent", outcome: "sent", vendor_message_id: "sgCampaign1" });
    expect(mapSendResult(r.status, r.body)).toMatchObject({ outcome: "sent", providerMessageId: "sgCampaign1" });
  });

  it("the database refuses it → refused before any provider call", async () => {
    const s = setup({ admit: { data: { ok: false, reason: "sender_unverified" }, error: null } });
    const r = await s.request(campaign);
    expect(refused(r)).toBe(true);
    expect(s.sendgridCalls()).toEqual([]);
    expect(mapSendResult(r.status, r.body).outcome).toBe("failed");
  });

  it("an admission for another business, or another recipient, is not this send's → refused", async () => {
    for (const data of [{ ok: true, tenant_id: OTHER_TENANT, recipient_id: RECIPIENT }, { ok: true, tenant_id: TENANT, recipient_id: CONTACT }]) {
      const s = setup({ admit: { data, error: null } });
      const r = await s.request(campaign);
      expect(refused(r)).toBe(true);
      expect(s.sendgridCalls()).toEqual([]);
    }
  });

  it("the admission check erroring → refused, never sent", async () => {
    const s = setup({ admit: { data: null, error: { message: "db down" } } });
    expect(refused(await s.request(campaign))).toBe(true);
    expect(s.sendgridCalls()).toEqual([]);
  });

  it("a signed-in caller, a non-marketing send, or any other key never asks and is refused", async () => {
    for (const [caller, body] of [
      ["user", campaign],
      ["service", { ...campaign, marketing: undefined }],
      ["service", { ...campaign, idempotency_key: "anything" }],
      ["service", { ...campaign, idempotency_key: `ecr:${RECIPIENT}x` }],
    ] as const) {
      const s = setup({ caller });
      const r = await s.request(body as Record<string, unknown>);
      expect(s.admitCalls()).toEqual([]);
      expect(r.body.outcome === "sent").toBe(false);
      expect(s.sendgridCalls()).toEqual([]);
    }
  });

  it("an unreadable SendGrid answer (thrown, 5xx) is outcome_unknown, so the worker never resends it", async () => {
    for (const provider of ["throw", 500] as const) {
      const s = setup({ provider });
      const r = await s.request(campaign);
      expect(s.sendgridCalls().length).toBe(1);
      expect(r.body.outcome).toBe("outcome_unknown");
      expect(mapSendResult(r.status, r.body).outcome).toBe("outcome_unknown");
    }
  });

  it("a 4xx from SendGrid is a definitive failure (nothing was accepted)", async () => {
    const s = setup({ provider: 400 });
    const r = await s.request(campaign);
    expect(r.body.outcome).toBe("failed");
    expect(mapSendResult(r.status, r.body).outcome).toBe("failed");
  });
});
