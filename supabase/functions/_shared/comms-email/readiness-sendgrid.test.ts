// Experience 03 · S3 — PAIGE Email (SendGrid) sender readiness: four states, stable codes, and the
// rule that a connected inbox is never proof of an authorized sender. Runs in
// vitest.sales-invoice-delivery.config.ts (supabase/functions/_shared/comms-email/**).
import { describe, it, expect } from "vitest";
import { emailSenderReadiness, emailProvidersFor, commsEmailReadiness, readEmailSenderFacts, readCommsEmailReadiness, resolveCommsEmailParties, type EmailSenderFacts, type CommsEmailAdmin } from "./readiness.ts";
import { invoiceDeliveryReadiness } from "../sales-invoice-delivery/readiness.ts";

const T = "10000000-0000-4000-8000-0000000000a1", T2 = "10000000-0000-4000-8000-0000000000a2";
const C = "30000000-0000-4000-8000-0000000000c1", SG = "50000000-0000-4000-8000-0000000000f1", RS = "50000000-0000-4000-8000-0000000000f2";
const SECRET = "SG.this-value-must-never-appear";
type Row = Record<string, unknown>;
function admin(tables: Record<string, Row[]>, failTable?: string): CommsEmailAdmin & { reads: { table: string; filters: [string, unknown][] }[] } {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  return { reads, from: (table: string) => ({ select: () => {
    const filters: [string, unknown][] = []; reads.push({ table, filters });
    const fail = table === failTable;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = { eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => fail ? { data: null, error: { code: "XX" } } : { data: rows()[0] ?? null, error: null },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(fail ? { data: null, error: { code: "XX" } } : { data: rows(), error: null }).then(res, rej) };
    return q as never;
  } }) };
}
const sendgrid: EmailSenderFacts = { tenantMatches: true, active: true, provider: "sendgrid", fromAddress: "hello@own.example.invalid", credentialReferencePresent: false, sendgridSenderVerified: true };
const env = { resendConfigured: true, googleConfigured: true, sendgridConfigured: true };

describe("emailSenderReadiness — PAIGE Email (SendGrid) four states", () => {
  it.each([
    ["no connection", undefined, env, "TENANT_EMAIL_SENDER_MISSING"],
    ["inactive connection", { ...sendgrid, active: false }, env, "TENANT_EMAIL_SENDER_MISSING"],
    ["another business's connection", { ...sendgrid, tenantMatches: false }, env, "TENANT_EMAIL_SENDER_MISSING"],
    ["connected inbox, domain NOT verified", { ...sendgrid, sendgridSenderVerified: false }, env, "SENDER_VERIFICATION_MISSING"],
    ["connected inbox, verification fact absent", { ...sendgrid, sendgridSenderVerified: undefined }, env, "SENDER_VERIFICATION_MISSING"],
    ["verified, platform credential missing", sendgrid, { ...env, sendgridConfigured: false }, "EMAIL_PROVIDER_NOT_CONFIGURED"],
    ["verified + credential present", sendgrid, env, null],
  ] as const)("%s → %s", (_label, s, e, want) => {
    expect(emailSenderReadiness(s as EmailSenderFacts | undefined, e)?.reason ?? null).toBe(want);
  });
  it("verification is graded before the credential (the business's step is named first)", () => {
    expect(emailSenderReadiness({ ...sendgrid, sendgridSenderVerified: false }, { ...env, sendgridConfigured: false })?.reason).toBe("SENDER_VERIFICATION_MISSING");
  });
  it("a caller that does not state the SendGrid fact (invoice delivery) does not recognise SendGrid at all", () => {
    const legacy = { resendConfigured: true, googleConfigured: true };
    expect(emailSenderReadiness(sendgrid, legacy)?.reason).toBe("TENANT_EMAIL_SENDER_MISSING");
    expect(emailProvidersFor(legacy)).toEqual(["resend", "gmail", "smtp"]);
    expect(emailProvidersFor({ sendgridConfigured: false })).toContain("sendgrid");
    expect(invoiceDeliveryReadiness({ channel: "email", tenantMatches: true, recipient: "b@x.example.invalid", sender: sendgrid, ...legacy, preSend: { proceed: true, outcome: "proceed" } }).eligible).toBe(false);
  });
  it("Resend, Gmail and SMTP grade exactly as before when SendGrid is known", () => {
    const resend = { ...sendgrid, provider: "resend", sendgridSenderVerified: undefined };
    expect(emailSenderReadiness(resend, env)).toBeNull();
    expect(emailSenderReadiness(resend, { ...env, resendConfigured: false })?.reason).toBe("EMAIL_PROVIDER_NOT_CONFIGURED");
    expect(emailSenderReadiness({ ...resend, provider: "gmail" }, env)?.reason).toBe("EMAIL_RECONNECT_REQUIRED");
  });
  it("the full readiness carries the code through", () => {
    const ready = { recipient: "lead@x.example.invalid", sender: sendgrid, ...env, preSend: { proceed: true, outcome: "proceed" } };
    expect(commsEmailReadiness(ready)).toMatchObject({ eligible: true, reason: "READY_FOR_GOVERNED_REVIEW" });
    expect(commsEmailReadiness({ ...ready, sender: { ...sendgrid, sendgridSenderVerified: false } })).toMatchObject({ eligible: false, state: "needs_setup", reason: "SENDER_VERIFICATION_MISSING" });
  });
});

describe("readEmailSenderFacts / readCommsEmailReadiness — verification read from the business's own domain row", () => {
  const conn = (extra: Row = {}) => ({ id: SG, tenant_id: T, channel_type: "email", provider: "sendgrid", from_address: "Hello@Own.example.invalid", active: true, status: "active", credentials_vault_ref: null, config: {}, ...extra });
  const domain = (extra: Row = {}) => ({ tenant_id: T, domain: "own.example.invalid", sendgrid_status: "verified", sendgrid_domain_id: "sg-1", sendgrid_verified_at: "2026-10-13T00:00:00Z", ...extra });
  it("verified only for THIS business's row with every fact present", async () => {
    const a = admin({ channel_connectors: [conn()], tenant_email_domains: [domain()] });
    expect((await readEmailSenderFacts(a, T, SG))?.sendgridSenderVerified).toBe(true);
    expect(a.reads[1]).toEqual({ table: "tenant_email_domains", filters: [["tenant_id", T], ["domain", "own.example.invalid"]] });
    for (const d of [domain({ tenant_id: T2 }), domain({ sendgrid_status: "pending" }), domain({ sendgrid_domain_id: null }), domain({ sendgrid_verified_at: null }), domain({ domain: "other.example.invalid" })]) {
      expect((await readEmailSenderFacts(admin({ channel_connectors: [conn()], tenant_email_domains: [d] }), T, SG))?.sendgridSenderVerified).toBe(false);
    }
  });
  it("a row from another business is never accepted, even if a read returned it", async () => {
    // A mis-filtered read (or a future refactor that drops the tenant filter) must still fail closed.
    const leaky: CommsEmailAdmin = { from: (table: string) => ({ select: () => {
      const q = { eq: () => q, maybeSingle: async () => ({ data: table === "channel_connectors" ? conn() : domain({ tenant_id: T2 }), error: null }) };
      return q as never;
    } }) };
    expect((await readEmailSenderFacts(leaky, T, SG))?.sendgridSenderVerified).toBe(false);
  });
  it("a Resend connector reads no domain row (unchanged reads)", async () => {
    const a = admin({ channel_connectors: [conn({ provider: "resend" })], tenant_email_domains: [domain()] });
    expect((await readEmailSenderFacts(a, T, SG))?.sendgridSenderVerified).toBeUndefined();
    expect(a.reads.map((r) => r.table)).toEqual(["channel_connectors"]);
  });
  it("credential presence only: the value never reaches a result; a read failure is unavailable", async () => {
    const env2 = (k: string) => ({ RESEND_API_KEY: "re", SENDGRID_MAIL_SEND_API_KEY: SECRET } as Record<string, string>)[k];
    const pre = async () => ({ proceed: true, outcome: "proceed" });
    const ok = await readCommsEmailReadiness(admin({ channel_connectors: [conn()], tenant_email_domains: [domain()] }), { tenantId: T, contactId: C, recipient: "lead@x.example.invalid", connectorId: SG }, env2, pre);
    expect(ok).toMatchObject({ eligible: true, reason: "READY_FOR_GOVERNED_REVIEW" });
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    const noKey = await readCommsEmailReadiness(admin({ channel_connectors: [conn()], tenant_email_domains: [domain()] }), { tenantId: T, contactId: C, recipient: "lead@x.example.invalid", connectorId: SG }, (k) => k === "RESEND_API_KEY" ? "re" : undefined, pre);
    expect(noKey.reason).toBe("EMAIL_PROVIDER_NOT_CONFIGURED");
    const unverified = await readCommsEmailReadiness(admin({ channel_connectors: [conn()], tenant_email_domains: [] }), { tenantId: T, contactId: C, recipient: "lead@x.example.invalid", connectorId: SG }, env2, pre);
    expect(unverified.reason).toBe("SENDER_VERIFICATION_MISSING");
    const failed = await readCommsEmailReadiness(admin({ channel_connectors: [conn()], tenant_email_domains: [domain()] }, "tenant_email_domains"), { tenantId: T, contactId: C, recipient: "lead@x.example.invalid", connectorId: SG }, env2, pre);
    expect(failed).toMatchObject({ eligible: false, state: "unavailable", reason: "EMAIL_READINESS_UNVERIFIED" });
  });
  it("party resolution lists SendGrid senders only when the caller passes the SendGrid-aware provider list", async () => {
    const contact = { id: C, tenant_id: T, first_name: "Riley", client_contact_methods: [{ kind: "email", value: "lead@x.example.invalid", is_primary: true, position: 0 }] };
    const tables = { clients: [contact], channel_connectors: [conn(), conn({ id: RS, provider: "resend", from_address: "owner@resend.example.invalid" })] };
    expect(await resolveCommsEmailParties(admin(tables), { tenantId: T, contactId: C, connectorId: null })).toMatchObject({ kind: "resolved", connectorId: RS });
    expect(await resolveCommsEmailParties(admin(tables), { tenantId: T, contactId: C, connectorId: null }, emailProvidersFor({ sendgridConfigured: true }))).toMatchObject({ kind: "sender_choice_required" });
  });
});
