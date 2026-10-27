// @vitest-environment node
// The one SendGrid transport for PAIGE's own email (_shared/email/platform-sendgrid.ts). fetch is a stub:
// nothing leaves this process.
import { describe, it, expect } from "vitest";
import { platformFrom, sendPlatformEmail, tenantFrom } from "../../supabase/functions/_shared/email/platform-sendgrid.ts";

type Call = { url: string; init: { headers: Record<string, string>; body: string } };
function stub(res: Response | Error) {
  const calls: Call[] = [];
  const f = ((url: string, init: Call["init"]) => {
    calls.push({ url, init });
    return res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const accepted = () => new Response(null, { status: 202, headers: { "X-Message-Id": "sgAbc123" } });

describe("platformFrom", () => {
  it("keeps a From already on the platform domain", () => {
    expect(platformFrom("Paige Agent AI <team@mail.paigeagent.ai>")).toEqual({ email: "team@mail.paigeagent.ai", name: "Paige Agent AI" });
    expect(platformFrom("notify@mail.paigeagent.ai")).toEqual({ email: "notify@mail.paigeagent.ai" });
  });
  it("moves Paige's own addresses onto the platform domain, keeping name and local part", () => {
    expect(platformFrom("Paige Agent AI <hello@paigeagent.ai>")).toEqual({ email: "hello@mail.paigeagent.ai", name: "Paige Agent AI" });
    expect(platformFrom("calendar@PAIGEAGENT.AI").email).toBe("calendar@mail.paigeagent.ai");
  });
  it("never reuses a business's own local part, so it cannot land on another business's shared address", () => {
    expect(platformFrom("Cedar <news@cedar-studio.example>")).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Cedar" });
    // Business B setting its local part to business A's shared one (acme@mail.paigeagent.ai).
    expect(platformFrom("B <acme@tenantb.example>").email).toBe("notifications@mail.paigeagent.ai");
    // A domain another business verified in the shared account is never borrowed, nor is a subdomain.
    expect(platformFrom("x@sg-mail.paigeagent.ai").email).toBe("notifications@mail.paigeagent.ai");
    expect(platformFrom("x@evil.mail.paigeagent.ai").email).toBe("notifications@mail.paigeagent.ai");
  });
  it("keeps a brand name in any script", () => {
    expect(platformFrom("José Müller Coaching <a@mail.paigeagent.ai>").name).toBe("José Müller Coaching");
    expect(platformFrom("O’Neil & Co. <a@mail.paigeagent.ai>").name).toBe("O’Neil & Co.");
  });
  it("falls back to no-reply for an unreadable From and strips header-breaking characters from the name", () => {
    expect(platformFrom("garbage").email).toBe("no-reply@mail.paigeagent.ai");
    expect(platformFrom('"Evil\r\nBcc: x" <a@mail.paigeagent.ai>').name).not.toMatch(/[\r\n"]/);
    expect(platformFrom('"support@bank.example" <a@mail.paigeagent.ai>').name).not.toContain("@");
  });
});

// Security H2: a From from a business's data (any workspace admin can write a connector) keeps a
// shared-domain address ONLY when it is that business's own managed address, resolved server-side.
describe("tenantFrom", () => {
  const OWN = "acme@mail.paigeagent.ai";
  it("keeps the business's own managed address, in any case or spacing on either side", () => {
    expect(tenantFrom("Acme <acme@mail.paigeagent.ai>", OWN)).toEqual({ email: OWN, name: "Acme" });
    expect(tenantFrom("Acme < ACME@Mail.PaigeAgent.AI >", [" Acme@MAIL.paigeagent.ai "])).toEqual({ email: OWN, name: "Acme" });
    expect(tenantFrom("  acme@mail.paigeagent.ai  ", ["hello@acme.example", OWN])).toEqual({ email: OWN });
  });
  it("another business's managed address is never kept (its slug, any case)", () => {
    expect(tenantFrom("Acme <otherbiz@mail.paigeagent.ai>", OWN)).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Acme" });
    expect(tenantFrom("OTHERBIZ@MAIL.PAIGEAGENT.AI", OWN).email).toBe("notifications@mail.paigeagent.ai");
  });
  it("never sends as PAIGE: a paigeagent.ai address is never remapped, a shared-domain PAIGE address never kept", () => {
    for (const a of ["support@paigeagent.ai", "Support@PaigeAgent.ai", "team@paigeagent.ai", "support@mail.paigeagent.ai", " TEAM@mail.paigeagent.ai "]) {
      expect(tenantFrom(`Acme <${a.trim()}>`, OWN), a).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Acme" });
    }
  });
  it("with no own managed address on record, nothing on the shared domain is kept", () => {
    expect(tenantFrom("acme@mail.paigeagent.ai", null).email).toBe("notifications@mail.paigeagent.ai");
    expect(tenantFrom("acme@mail.paigeagent.ai", []).email).toBe("notifications@mail.paigeagent.ai");
    // An "own" value that is not on the shared domain never widens what is kept.
    expect(tenantFrom("hello@acme.example", "hello@acme.example").email).toBe("notifications@mail.paigeagent.ai");
  });
  it("a business's own domain and an unreadable From go as notifications@", () => {
    expect(tenantFrom("Cedar <news@cedar.example>", OWN)).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Cedar" });
    expect(tenantFrom("garbage", OWN).email).toBe("notifications@mail.paigeagent.ai");
    expect(tenantFrom("x@evil.mail.paigeagent.ai", "x@evil.mail.paigeagent.ai").email).toBe("notifications@mail.paigeagent.ai");
  });
});

describe("sendPlatformEmail", () => {
  it("sends one SendGrid request with the Mail Send key and returns X-Message-Id", async () => {
    const s = stub(accepted());
    const r = await sendPlatformEmail({
      from: "Paige Agent AI <hello@paigeagent.ai>", to: "lead@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi",
      replyTo: "support@paigeagent.ai", headers: { "List-Unsubscribe": "<https://u.example>" },
      attachments: [{ filename: "invite.ics", content: "QkVHSU4=", type: "text/calendar" }],
    }, { fetch: s.f, apiKey: "SG.key" });
    expect(r).toEqual({ ok: true, status: 202, id: "sgAbc123", error: null, unconfirmed: false });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(s.calls[0].init.headers.Authorization).toBe("Bearer SG.key");
    const body = JSON.parse(s.calls[0].init.body);
    expect(body.from).toEqual({ email: "hello@mail.paigeagent.ai", name: "Paige Agent AI" });
    expect(body.personalizations).toEqual([{ to: [{ email: "lead@example.test" }] }]);
    expect(body.reply_to).toEqual({ email: "support@paigeagent.ai" });
    expect(body.content.map((c: { type: string }) => c.type)).toEqual(["text/plain", "text/html"]);
    expect(body.headers).toEqual({ "List-Unsubscribe": "<https://u.example>" });
    expect(body.attachments).toEqual([{ content: "QkVHSU4=", filename: "invite.ics", disposition: "attachment", type: "text/calendar" }]);
  });
  it("without the key, or without a valid recipient or content, sends nothing", async () => {
    const s = stub(accepted());
    expect((await sendPlatformEmail({ from: "a@mail.paigeagent.ai", to: "x@example.test", subject: "s", html: "h" }, { fetch: s.f, apiKey: null })).error).toBe("email_provider_not_configured");
    expect((await sendPlatformEmail({ from: "a@mail.paigeagent.ai", to: "nope", subject: "s", html: "h" }, { fetch: s.f, apiKey: "k" })).error).toBe("recipient_invalid");
    expect((await sendPlatformEmail({ from: "a@mail.paigeagent.ai", to: "x@example.test", subject: "s" }, { fetch: s.f, apiKey: "k" })).error).toBe("content_missing");
    expect(s.calls).toHaveLength(0);
  });
  it("a 4xx is a definitive failure; a 5xx, a timeout or a thrown request is unconfirmed", async () => {
    const send = (res: Response | Error) => sendPlatformEmail({ from: "a@mail.paigeagent.ai", to: "x@example.test", subject: "s", html: "h" }, { fetch: stub(res).f, apiKey: "k" });
    expect(await send(new Response("{}", { status: 403 }))).toMatchObject({ ok: false, status: 403, unconfirmed: false, error: "email_provider_403" });
    expect(await send(new Response("{}", { status: 502 }))).toMatchObject({ ok: false, status: 502, unconfirmed: true });
    expect(await send(Object.assign(new Error("t"), { name: "TimeoutError" }))).toMatchObject({ ok: false, status: 0, unconfirmed: true, error: "email_provider_timeout" });
    expect(await send(new Error("reset"))).toMatchObject({ ok: false, unconfirmed: true, error: "email_provider_unreachable" });
  });
  it("never puts the key or the message into its error", async () => {
    const r = await sendPlatformEmail({ from: "a@mail.paigeagent.ai", to: "x@example.test", subject: "secret subject", html: "h" },
      { fetch: stub(new Response("bad request: SG.key secret subject", { status: 400 })).f, apiKey: "SG.key" });
    expect(JSON.stringify(r)).not.toMatch(/SG\.key|secret subject/);
  });
});
