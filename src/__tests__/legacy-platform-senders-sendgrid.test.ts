// @vitest-environment node
/**
 * The four legacy platform senders (welcome, payment confirmation, support request, funding report)
 * moved off Resend onto PAIGE's one SendGrid transport (owner ruling 2026-10-26). The ACTUAL handler
 * source is compiled and driven; the database and the network are synthetic ports. The transport is
 * the real _shared/email/platform-sendgrid.ts with only its fetch stubbed, so the assertions read the
 * exact SendGrid request each handler builds. Nothing leaves the process. This is not provider proof.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as platformSendgrid from "../../supabase/functions/_shared/email/platform-sendgrid.ts";

type Row = Record<string, unknown>;
type SgCall = { url: string; headers: Record<string, string>; body: Row };

function load(fn: string, providers: Array<() => Response>) {
  const source = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const calls: SgCall[] = [];
  const inserts: Array<{ table: string; row: Row }> = [];
  const rows: Record<string, unknown> = {
    profiles: { full_name: "Fixture Owner", is_complimentary: false },
    user_roles: [],
    user_subscriptions: null,
    build_scores: { build_score: 80, current_tier: "B" },
    financial_kpis: null,
    businesses: [], credit_accounts: [], funding_offers: [],
  };
  const from = (table: string) => {
    const one = () => Promise.resolve({ data: Array.isArray(rows[table]) ? null : rows[table] ?? null, error: null });
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      single: one, maybeSingle: one,
      insert: (row: Row) => { inserts.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(rows[table]) ? rows[table] : [], error: null }).then(ok),
    };
    return q;
  };
  const client = {
    from,
    auth: { getUser: async (token: string) => ({ data: { user: token === "owner-jwt" ? { id: "owner-1", email: "owner@example.invalid" } : null }, error: null }) },
  };
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.190.0/http/server.ts": { serve: (h: typeof handler) => { handler = h; } },
    "https://esm.sh/@supabase/supabase-js@2.57.2": { createClient: () => client },
    "https://esm.sh/@supabase/supabase-js@2.75.0": { createClient: () => client },
    "../_shared/user-contact-methods.ts": {
      primaryEmailForUser: async () => "owner@example.invalid",
      primaryPhonesForUsers: async () => new Map(),
    },
    "../_shared/email/platform-sendgrid.ts": {
      ...platformSendgrid,
      sendPlatformEmail: (input: platformSendgrid.PlatformEmail, deps: platformSendgrid.PlatformDeps = {}) =>
        platformSendgrid.sendPlatformEmail(input, { ...deps, fetch: (async (url: string, init: { headers: Record<string, string>; body: string }) => {
          calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
          const next = providers[calls.length - 1];
          if (!next) throw new Error("Unexpected extra provider send");
          return next();
        }) as unknown as typeof fetch }),
    },
  };
  const require = (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected runtime import ${id}`);
    return modules[id];
  };
  const env: Record<string, string> = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_ANON_KEY: "anon", SENDGRID_MAIL_SEND_API_KEY: "test-mail-send-key" };
  const deno = { env: { get: (k: string) => env[k] } };
  new Function("require", "exports", "Deno", "fetch", compiled)(require, {}, deno, () => { throw new Error("Direct network forbidden"); });
  return {
    calls, inserts,
    async invoke(body: Row) {
      if (!handler) throw new Error("handler not captured");
      const res = await handler(new Request(`https://fixture.invalid/functions/v1/${fn}`, {
        method: "POST", headers: { Authorization: "Bearer owner-jwt", "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() };
    },
  };
}

const accepted = (id: string) => () => new Response(null, { status: 202, headers: { "X-Message-Id": id } });
const unavailable = () => new Response("upstream", { status: 503 });
const refused = () => new Response("bad request", { status: 400 });

describe("send-welcome-email", () => {
  const body = { fullName: "Fixture Owner", email: "owner@example.invalid" };
  it("sends one SendGrid request from hello@ on the platform domain and keeps the response shape", async () => {
    const f = load("send-welcome-email", [accepted("sgWelcome")]);
    const r = await f.invoke(body);
    expect(r).toEqual({ status: 200, body: { success: true, data: { data: { id: "sgWelcome" }, error: null } } });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(f.calls[0].headers.Authorization).toBe("Bearer test-mail-send-key");
    // "Just reply to this email" — the reply reaches PAIGE's real inbox, not the sending-only mail. subdomain.
    expect(f.calls[0].body).toMatchObject({ from: { email: "hello@mail.paigeagent.ai", name: "Paige Agent AI" }, reply_to: { email: "hello@paigeagent.ai" }, personalizations: [{ to: [{ email: "owner@example.invalid" }] }], subject: "Welcome to Paige Agent AI" });
    expect(f.inserts.map(i => i.table)).toEqual(["notifications"]);
  });
  it("reports a definitive refusal as a failure, not as sent", async () => {
    const f = load("send-welcome-email", [refused]);
    const r = await f.invoke(body);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ success: false, unconfirmed: false, error: "email_provider_400" });
  });
});

describe("send-payment-confirmation-email", () => {
  const body = { planName: "Pro", amount: 4900 };
  it("sends from billing@ on the platform domain and keeps the response shape", async () => {
    const f = load("send-payment-confirmation-email", [accepted("sgPay")]);
    const r = await f.invoke(body);
    expect(r).toEqual({ status: 200, body: { success: true, data: { data: { id: "sgPay" }, error: null } } });
    expect(f.calls[0].body).toMatchObject({ from: { email: "billing@mail.paigeagent.ai" }, reply_to: { email: "hello@paigeagent.ai" }, subject: "Payment confirmed — Paige Agent AI" });
  });
  it("reports a 5xx as UNCONFIRMED — neither sent nor a plain failure", async () => {
    const f = load("send-payment-confirmation-email", [unavailable]);
    const r = await f.invoke(body);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ success: false, unconfirmed: true, error: "email_unconfirmed" });
    expect(f.calls).toHaveLength(1);
  });
});

describe("send-support-request", () => {
  const body = { subject: "Help", category: "general", message: "Hi", preferredContact: "email", requestConsultation: false, userEmail: "owner@example.invalid" };
  it("notifies the team (replies to the person) and then confirms to the person, both from support@", async () => {
    const f = load("send-support-request", [accepted("sgTeam"), accepted("sgUser")]);
    const r = await f.invoke(body);
    expect(r).toEqual({ status: 200, body: { success: true, message: "Support request submitted successfully", confirmation_emailed: true } });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].body).toMatchObject({ from: { email: "support@mail.paigeagent.ai" }, reply_to: { email: "owner@example.invalid" } });
    expect(f.calls[1].body).toMatchObject({ from: { email: "support@mail.paigeagent.ai" }, reply_to: { email: "support@paigeagent.ai" }, personalizations: [{ to: [{ email: "owner@example.invalid" }] }] });
  });
  it("an UNCONFIRMED team notification is not confirmed to the person, and says to check before resending", async () => {
    const f = load("send-support-request", [unavailable]);
    const r = await f.invoke(body);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ unconfirmed: true });
    expect(String(r.body.error)).toMatch(/may have/);
    expect(f.calls).toHaveLength(1);
  });
});

describe("send-funding-report", () => {
  it("sends from the platform domain, records the notification, and keeps emailData's shape", async () => {
    const f = load("send-funding-report", [accepted("sgFund")]);
    const r = await f.invoke({ userId: "owner-1" });
    expect(r).toEqual({ status: 200, body: { success: true, emailData: { data: { id: "sgFund" }, error: null } } });
    expect(f.calls[0].body).toMatchObject({ from: { email: "notifications@mail.paigeagent.ai", name: "Paige AI" }, reply_to: { email: "hello@paigeagent.ai" }, personalizations: [{ to: [{ email: "owner@example.invalid" }] }], subject: "Your Funding Readiness Report" });
    expect(f.inserts).toEqual([{ table: "plaid_notifications", row: expect.objectContaining({ template: "funding_report", metadata: { email: "owner@example.invalid", response: { data: { id: "sgFund" }, error: null } } }) }]);
  });
  it("a refused send is a failure and records no sent notification", async () => {
    const f = load("send-funding-report", [refused]);
    const r = await f.invoke({ userId: "owner-1" });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ success: false, unconfirmed: false });
    expect(f.inserts).toEqual([]);
  });
});

describe("no converted sender still reaches Resend", () => {
  // Comments are stripped: a comment recording the move is history, not a call.
  const code = (p: string) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  it.each([
    "supabase/functions/send-welcome-email/index.ts",
    "supabase/functions/send-payment-confirmation-email/index.ts",
    "supabase/functions/send-support-request/index.ts",
    "supabase/functions/send-funding-report/index.ts",
    "supabase/functions/skill-runner/index.ts",
    "supabase/functions/paige-mcp/index.ts",
    "supabase/functions/_shared/email/providers.ts",
  ])("%s", (p) => {
    const src = code(p);
    expect(src).not.toMatch(/api\.resend\.com|RESEND_API_KEY|from ["'](npm:|https:\/\/esm\.sh\/)resend@/);
    if (!p.endsWith("providers.ts")) expect(src).toMatch(/from "\.\.\/_shared\/email\/platform-sendgrid\.ts"/);
  });
});
