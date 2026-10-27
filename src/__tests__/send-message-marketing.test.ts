import { decideContentRead } from "../../supabase/functions/_shared/inbox-intelligence/policy.ts";
// send-message marketing mode (E1, owner rulings 2026-10-04): the real handler source, with only the
// network and database substituted (same harness as the invoice-delivery suite).
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../../supabase/functions/_shared/comms-provider-boundary";
import { buildListUnsubscribeHeaders } from "../../supabase/functions/_shared/channel-adapters";
import { senderDisplayName } from "../../supabase/functions/_shared/email/sender-display-name";
import { tenantFrom, PLATFORM_FROM_DOMAIN } from "../../supabase/functions/_shared/email/platform-sendgrid";

const tenant = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Sent = { msg: { body_html?: string | null }; ctx: { listUnsubscribeUrl?: string | null; idempotencyKey?: string | null } };

function setup(opts: { existingToken?: string | null; mintError?: boolean; hold?: boolean; restricted?: boolean } = {}) {
  const sent: Sent[] = [];
  const tokenWrites: unknown[] = [];
  const messageWrites: unknown[] = [];
  const adapters: Array<{ channel_type: string; send: (m: unknown, c: unknown) => Promise<unknown> }> = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  let handler: (req: Request) => Promise<Response>;
  const admin = {
    from: (table: string) => {
      const b: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order", "limit"]) b[m] = () => b;
      b.select = () => b;
      const result = () => {
        if (table === "clients") return { data: { tenant_id: tenant, client_contact_methods: [] }, error: null };
        if (table === "email_unsubscribe_tokens") {
          return { data: opts.existingToken ? { token: opts.existingToken } : null, error: null };
        }
        return { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null };
      };
      b.insert = (v: unknown) => { if (table === "messages") messageWrites.push(v); return b; };
      b.update = (v: unknown) => { if (table === "messages") messageWrites.push(v); return b; };
      b.upsert = (v: unknown) => {
        if (table === "email_unsubscribe_tokens") {
          tokenWrites.push(v);
          if (opts.mintError) return { ...b, then: (res: (v: unknown) => unknown) => Promise.resolve({ error: { message: "mint failed" } }).then(res) };
        }
        return b;
      };
      b.maybeSingle = async () => result();
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res, rej);
      return b;
    },
    rpc: async (name: string) => {
      if (name === "comms_provider_execution_allowed") return { data: !opts.restricted, error: null };
      if (name === "tenant_sender_identity") return { data: { from_address: "acme@mail.paigeagent.ai", from_name: "Acme" }, error: null };
      return { data: null, error: null };
    },
  };
  const scope = { decideContentRead,
    PAIGE_APP_ORIGIN: "https://app.example.test",
    Deno: {
      env: { get: (k: string) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? "internal" : k === "SUPABASE_URL" ? "https://db.example.test" : "configured") },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => admin,
    registerOutboundAdapter: (a: (typeof adapters)[number]) => { adapters.push(a); },
    buildListUnsubscribeHeaders, senderDisplayName, tenantFrom, PLATFORM_FROM_DOMAIN,
    commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED,
    getOutboundAdapter: () => ({
      send: async (msg: Sent["msg"], ctx: Sent["ctx"]) => {
        sent.push({ msg: { body_html: msg.body_html }, ctx: { listUnsubscribeUrl: ctx.listUnsubscribeUrl, idempotencyKey: ctx.idempotencyKey } });
        return { ok: true, status: "sent", provider_message_id: "re_123" };
      },
    }),
    runPreSend: async () => (opts.hold
      ? { proceed: false, outcome: "queued_quiet_hours", reason: "quiet hours", queueUntil: "2026-10-05T13:00:00.000Z" }
      : { proceed: true, outcome: "proceed" }),
    CLIENT_CONTACT_METHODS_EMBED: "client_contact_methods",
    clientAddresses: () => ({ email: "one@example.test", emails: ["one@example.test"], phones: [] }),
    fetch: async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(null, { status: 202, headers: { "X-Message-Id": "sg_abc" } });
    },
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (extra: Record<string, unknown> = {}) => {
    const r = await handler!(new Request("https://example.test/send-message", {
      method: "POST",
      headers: { Authorization: "Bearer internal" },
      body: JSON.stringify({
        channel: "email", to: "one@example.test", subject: "Spring update", contact_id: contact,
        body: '<p>Hi</p><a href="{{unsubscribe_url}}">Unsubscribe</a>', ...extra,
      }),
    }));
    return { status: r.status, body: await r.json() };
  };
  return { sent, tokenWrites, messageWrites, adapters, fetchCalls, request };
}

describe("send-message marketing mode", () => {
  it("refuses restricted marketing before token minting, provider dispatch or message admission", async () => {
    const s = setup({ restricted: true });
    const r = await s.request({ marketing: true });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe(COMMS_PROVIDER_EXECUTION_DISABLED);
    expect(s.sent).toHaveLength(0);
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.tokenWrites).toHaveLength(0);
    expect(s.messageWrites).toHaveLength(0);
  });
  it("replaces {{unsubscribe_url}} with the recipient's one-click link and carries it to the adapter", async () => {
    const s = setup();
    const r = await s.request({ marketing: true, idempotency_key: "ecr:abc" });
    expect(r.body.outcome).toBe("sent");
    expect(s.sent).toHaveLength(1);
    const url = s.sent[0].ctx.listUnsubscribeUrl!;
    expect(url).toMatch(/^https:\/\/db\.example\.test\/functions\/v1\/comms-email-unsubscribe\?token=[0-9a-f]{64}$/);
    expect(s.sent[0].msg.body_html).toContain(`href="${url}"`);
    expect(s.sent[0].msg.body_html).not.toContain("{{unsubscribe_url}}");
    expect(s.sent[0].ctx.idempotencyKey).toBe("ecr:abc");
  });

  it("refuses to send when no unsubscribe link can be minted", async () => {
    const s = setup({ mintError: true });
    const r = await s.request({ marketing: true });
    expect(r.body).toMatchObject({ outcome: "blocked_unsubscribe_unavailable", reason: "unsubscribe_unavailable" });
    expect(s.sent).toHaveLength(0);
  });

  it("refuses a marketing body that has no visible unsubscribe link", async () => {
    const s = setup();
    const r = await s.request({ marketing: true, body: "<p>No link here</p>" });
    expect(r.body).toMatchObject({ outcome: "blocked_unsubscribe_unavailable", reason: "unsubscribe_link_missing" });
    expect(s.sent).toHaveLength(0);
  });

  it("reuses the recipient's unused token instead of rotating it", async () => {
    const s = setup({ existingToken: "f".repeat(64) });
    await s.request({ marketing: true });
    expect(s.sent[0].ctx.listUnsubscribeUrl).toBe(`https://db.example.test/functions/v1/comms-email-unsubscribe?token=${"f".repeat(64)}`);
    expect(s.tokenWrites).toHaveLength(0);
  });

  it("never queues a held marketing email for the generic drain: nothing is written, the caller defers it", async () => {
    const s = setup({ hold: true });
    const r = await s.request({ marketing: true });
    expect(r.body).toMatchObject({ deferred: true, outcome: "queued_quiet_hours", scheduled_for: "2026-10-05T13:00:00.000Z", message_id: null });
    expect(s.messageWrites).toHaveLength(0);
    expect(s.sent).toHaveLength(0);
  });

  it("refuses a marketing send shaped like a schedule or a draft release", async () => {
    for (const extra of [{ scheduled_for: "2099-01-01T00:00:00Z" }, { message_id: "44444444-4444-4444-8444-444444444444" }, { channel: "sms" }]) {
      const s = setup();
      const r = await s.request({ marketing: true, ...extra });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("marketing_send_shape_invalid");
      expect(s.sent).toHaveLength(0);
    }
  });

  it("does not advertise List-Unsubscribe on an ordinary send", async () => {
    const s = setup();
    await s.request({});
    expect(s.sent[0].ctx.listUnsubscribeUrl).toBeNull();
  });

  it("leaves a non-marketing send as it was: placeholder untouched, a failed mint does not block", async () => {
    const s = setup({ mintError: true });
    const r = await s.request({});
    expect(r.body.outcome).toBe("sent");
    expect(s.sent[0].msg.body_html).toContain("{{unsubscribe_url}}");
    expect(s.sent[0].ctx.listUnsubscribeUrl).toBeNull();
    expect(s.sent[0].ctx.idempotencyKey).toBeNull();
  });

  it("ignores an idempotency key that is not a plain token", async () => {
    const s = setup();
    await s.request({ marketing: true, idempotency_key: "bad key\r\nX-Evil: 1" });
    expect(s.sent[0].ctx.idempotencyKey).toBeNull();
  });
});

describe("email adapter (SendGrid route, Experience 03) headers", () => {
  it("sends List-Unsubscribe and List-Unsubscribe-Post when given, and no idempotency header (SendGrid has no replay)", async () => {
    const s = setup();
    const email = s.adapters.find((a) => a.channel_type === "email")!;
    const out = await email.send(
      { subject: "Hi", body_html: "<p>x</p>" },
      { from: { address: "acme@mail.paigeagent.ai" }, to: "one@example.test", providerApiKey: "k",
        listUnsubscribeUrl: "https://db.example.test/u?token=t", idempotencyKey: "ecr:1", ownManagedAddresses: ["acme@mail.paigeagent.ai"] } as never,
    );
    expect(out).toEqual({ ok: true, status: "sent", provider_message_id: "sg_abc" });
    expect(s.fetchCalls.map((c) => c.url)).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
    const call = s.fetchCalls[0];
    const reqHeaders = call.init.headers as Record<string, string>;
    expect(reqHeaders.Authorization).toBe("Bearer k");
    expect(Object.keys(reqHeaders).filter((h) => /idempotency/i.test(h))).toEqual([]);
    const payload = JSON.parse(String(call.init.body));
    expect(payload.headers["List-Unsubscribe"]).toBe("<https://db.example.test/u?token=t>, <mailto:unsubscribe@mail.paigeagent.ai>");
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.from).toEqual({ email: "acme@mail.paigeagent.ai" });
  });

  it("sends no unsubscribe headers when there is none; In-Reply-To is carried as a header", async () => {
    const s = setup();
    const email = s.adapters.find((a) => a.channel_type === "email")!;
    await email.send({ subject: "Hi", body_html: "<p>x</p>" }, { from: { address: "a@mail.paigeagent.ai" }, to: "one@example.test", providerApiKey: "k" });
    expect(JSON.parse(String(s.fetchCalls[0].init.body)).headers).toBeUndefined();
    await email.send({ subject: "Re: Hi", body_html: "<p>y</p>", in_reply_to_provider_id: "<abc@mail>" }, { from: { address: "a@mail.paigeagent.ai" }, to: "one@example.test", providerApiKey: "k" });
    expect(JSON.parse(String(s.fetchCalls[1].init.body)).headers).toEqual({ "In-Reply-To": "<abc@mail>" });
  });

  it("H2: a business's own domain never appears as the From; a business's data never sends as PAIGE", async () => {
    const s = setup();
    const email = s.adapters.find((a) => a.channel_type === "email")!;
    await email.send({ subject: "Hi", body_html: "<p>x</p>" }, { from: { address: "hello@acme.example", display_name: "Acme Studio" }, to: "one@example.test", providerApiKey: "k", provider: "resend" });
    await email.send({ subject: "Hi", body_html: "<p>x</p>" }, { from: { address: "hello@acme.example", display_name: "Acme" }, to: "one@example.test", replyTo: "desk@acme.example", providerApiKey: "k" });
    await email.send({ subject: "Hi", body_html: "<p>x</p>" }, { from: { address: "team@paigeagent.ai", display_name: "Paige" }, to: "one@example.test", providerApiKey: "k" });
    const p = s.fetchCalls.map((c) => JSON.parse(String(c.init.body)));
    expect(p[0].from).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Acme Studio" });
    expect(p[0].reply_to).toEqual({ email: "hello@acme.example" });
    expect(p[1].from).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Acme" });
    expect(p[1].reply_to).toEqual({ email: "desk@acme.example" });
    // A paigeagent.ai address in a business's data is never remapped onto the shared domain (tenantFrom),
    // and no Reply-To is pointed at PAIGE.
    expect(p[2].from).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Paige" });
    expect(p[2].reply_to).toBeUndefined();
  });

  it("an attachment (an invoice PDF) rides the SendGrid request", async () => {
    const s = setup();
    const email = s.adapters.find((a) => a.channel_type === "email")!;
    await email.send({ subject: "Invoice", body_html: "<p>x</p>" }, { from: { address: "a@mail.paigeagent.ai" }, to: "one@example.test", providerApiKey: "k",
      serverAttachments: [{ filename: "INV-1.pdf", content: "JVBERi0=", contentType: "application/pdf" }] } as never);
    expect(JSON.parse(String(s.fetchCalls[0].init.body)).attachments).toEqual([{ content: "JVBERi0=", filename: "INV-1.pdf", type: "application/pdf", disposition: "attachment" }]);
  });
});

describe("gmailSend extra headers", () => {
  it("writes List-Unsubscribe into the RFC 822 message and refuses header injection", async () => {
    // An untyped specifier keeps the Deno module graph out of the browser TS project (CI's affected-edge
    // gate typechecks it under Deno); vitest still executes the real module.
    const gmailPath = "../../supabase/functions/_shared/gmail.ts";
    const { gmailSend } = (await import(/* @vite-ignore */ gmailPath)) as {
      gmailSend: (token: string, input: Record<string, unknown>) => Promise<{ ok: boolean }>;
    };
    let raw = "";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      raw = JSON.parse(String(init.body)).raw;
      return new Response(JSON.stringify({ id: "g1" }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await gmailSend("tok", {
        from: "owner@acme.test", to: "one@example.test", subject: "Hi", html: "<p>x</p>",
        headers: {
          "List-Unsubscribe": "<https://u.test/x?token=t>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click\r\nBcc: thief@evil.test",
          "Bad Name: x\r\nBcc": "thief@evil.test",
        },
      });
      expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
    const msg = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const head = msg.split("\r\n\r\n")[0];
    expect(head).toContain("List-Unsubscribe: <https://u.test/x?token=t>");
    expect(head).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click Bcc: thief@evil.test");
    expect(head.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
});
