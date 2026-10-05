// @vitest-environment node
// INT-328 — the comms.email_send declarations, and the pure contract every seam must agree on.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk";
import { COMMS_EMAIL_SEND, COMMS_EMAIL_SEND_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/comms";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry, getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry";
import { COMMS_EMAIL_TOOL, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest, normalizeCommsEmailAddress } from "../../supabase/functions/_shared/comms-email/contract";
import { emailSenderReadiness, commsEmailReadiness, commsEmailReadinessOutcome, type EmailSenderFacts } from "../../supabase/functions/_shared/comms-email/readiness";
import { invoiceDeliveryReadiness } from "../../supabase/functions/_shared/sales-invoice-delivery/readiness";
import { commsEmailSafeResult } from "../../supabase/functions/_shared/comms-email/adapter";

const id = "11111111-1111-4111-8111-111111111111";

describe("comms.email_send Spine + Kit declaration", () => {
  it("registers one external-effect capability bound to the canonical high-risk chat tool", () => {
    expect(getSpineCapability("comms.email_send")).toBe(COMMS_EMAIL_SEND);
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
    expect(COMMS_EMAIL_SEND.action).toMatchObject({ classification: "external_effect", executor: "public.prepare_comms_email_send", chatTool: COMMS_EMAIL_TOOL, riskPolicyKey: "high", approvalAuthority: "chat-canonical" });
    expect(COMMS_EMAIL_SEND.outcome.projector).toBe("public.read_comms_email_send_result");
    expect(COMMS_EMAIL_SEND.outcome.railVisibility).toMatch(/never delivered/i);
    expect(PAIGE_SPINE_CAPABILITIES.filter(c => c.action?.chatTool === COMMS_EMAIL_TOOL)).toHaveLength(1);
  });
  it("Kit declaration matches the canonical policy and exposes no request-authored authority", () => {
    const c = COMMS_EMAIL_SEND_CAPABILITY;
    expect(c.governance).toMatchObject({ actionRiskKey: COMMS_EMAIL_TOOL, risk: "high", approval: "confirm" });
    expect(classifyAction(COMMS_EMAIL_TOOL)).toBe("high");
    expect(c.effect).toBe("external_effect");
    expect(c.idempotency).toMatchObject({ mode: "required", readback: "public.read_comms_email_send_result", replay: "reconcile_then_return" });
    expect(c.receipt).toMatchObject({ rail: true, recorder: "record_capability_run", redaction: "tenant_safe" });
    expect(c.input.additionalProperties).toBe(false);
    expect(c.input.required).toEqual(["contact_id", "subject", "body"]);
    for (const forbidden of ["to", "recipient", "from_address", "body_html", "expected_tenant_id", "governance", "approved_fingerprint", "marketing"]) expect(c.input.properties).not.toHaveProperty(forbidden);
    expect(Object.isFrozen(c)).toBe(true);
  });
});

describe("the canonical command", () => {
  it("accepts the closed shape, lower-cases ids and keeps subject/body verbatim", () => {
    expect(parseCommsEmailCommand({ action: "comms.email_send", contact_id: id.toUpperCase(), subject: " Hi ", body: "Body\n" }))
      .toEqual({ action: "comms.email_send", contact_id: id, connector_id: null, subject: " Hi ", body: "Body\n" });
  });
  it("refuses unknown keys, header injection, NUL, empty and oversized content", () => {
    const base = { action: "comms.email_send", contact_id: id, subject: "Hi", body: "Body" };
    for (const bad of [{ ...base, to: "x@y.z" }, { ...base, action: "invoice.email_send" }, { ...base, contact_id: "nope" }, { ...base, connector_id: "nope" },
      { ...base, subject: "a\nb" }, { ...base, subject: "a\rb" }, { ...base, subject: "   " }, { ...base, subject: "x".repeat(201) },
      { ...base, body: "  " }, { ...base, body: "x".repeat(10001) }, { ...base, body: "a\u0000b" }, null, []]) {
      expect(() => parseCommsEmailCommand(bad)).toThrow();
    }
    expect(() => parseCommsEmailCommand({ ...base, subject: "x".repeat(200), body: "x".repeat(10000) })).not.toThrow();
  });
  it("derives escaped paragraph HTML deterministically from plain text", () => {
    expect(commsEmailBodyHtml("Hi <Dana> & 'team'\r\nline two\n\n\n  Second \"para\"\n")).toBe("<p>Hi &lt;Dana&gt; &amp; &#39;team&#39;<br>line two</p><p>Second &quot;para&quot;</p>");
    expect(commsEmailBodyHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
  it("digests exactly recipient \\n connector \\n subject \\n body — the formula prepare_comms_email_send recomputes", async () => {
    const input = { recipient: "dana@example.test", connectorId: id, subject: "Héllo", bodyText: "Line 1\nLine 2" };
    const expected = createHash("sha256").update(`dana@example.test\n${id}\nHéllo\nLine 1\nLine 2`, "utf8").digest("hex");
    expect(await commsEmailContentDigest(input)).toBe(expected);
    const migration = readFileSync("supabase/migrations/20270589000000_comms_email_send.sql", "utf8");
    expect(migration).toContain("_recipient||E'\\n'||_connector_id::text||E'\\n'||_subject||E'\\n'||_body_text,'UTF8'),'sha256'),'hex')");
  });
  it("normalizes addresses the way send-message compares them", () => {
    expect(normalizeCommsEmailAddress("  Dana@Example.TEST ")).toBe("dana@example.test");
    expect(normalizeCommsEmailAddress("not an address")).toBeNull();
  });
});

describe("readiness — one email-sender check for invoice and comms", () => {
  const sender: EmailSenderFacts = { tenantMatches: true, active: true, provider: "resend", fromAddress: "owner@business.test", credentialReferencePresent: false };
  const env = { resendConfigured: true, googleConfigured: true };
  const senders: (EmailSenderFacts | undefined)[] = [undefined, sender, { ...sender, active: false }, { ...sender, tenantMatches: false }, { ...sender, fromAddress: null }, { ...sender, fromAddress: "bad" }, { ...sender, provider: "mailchimp" },
    { ...sender, provider: "gmail" }, { ...sender, provider: "gmail", credentialReferencePresent: true }, { ...sender, provider: "smtp", credentialReferencePresent: true }, { ...sender, provider: "smtp", credentialReferencePresent: true, smtpConfigured: true }];
  // The invoice email branch exactly as it stood before the extraction (base 51be9b7), kept here as
  // the oracle: the extraction is behavior-preserving only if the shared check agrees with it.
  const original = (s: EmailSenderFacts | undefined, f: { resendConfigured: boolean; googleConfigured: boolean }) => {
    if (!s || !s.tenantMatches || !s.active || !s.fromAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.fromAddress) || !["resend", "gmail", "smtp"].includes(s.provider)) return "TENANT_EMAIL_SENDER_MISSING";
    if (s.provider === "resend" && !f.resendConfigured) return "EMAIL_PROVIDER_NOT_CONFIGURED";
    if (s.provider === "gmail" && (!f.googleConfigured || !s.credentialReferencePresent)) return "EMAIL_RECONNECT_REQUIRED";
    if (s.provider === "smtp" && (!s.credentialReferencePresent || !s.smtpConfigured)) return "EMAIL_RECONNECT_REQUIRED";
    return null;
  };
  it("the extracted sender check, and invoice readiness through it, agree with the pre-extraction branch for every sender shape", () => {
    let checked = 0;
    for (const s of senders) for (const e of [env, { resendConfigured: false, googleConfigured: false }, { resendConfigured: true, googleConfigured: false }]) {
      const want = original(s, e);
      expect(emailSenderReadiness(s, e)?.reason ?? null).toBe(want);
      const invoice = invoiceDeliveryReadiness({ channel: "email", tenantMatches: true, recipient: "billing@example.test", sender: s, ...e, preSend: { proceed: true, outcome: "proceed" } });
      expect(invoice.reason).toBe(want ?? "READY_FOR_GOVERNED_REVIEW");
      checked++;
    }
    expect(checked).toBe(senders.length * 3);
  });
  it("grades recipient, sender choice, sender setup and recipient preferences in that order", () => {
    const ready = { recipient: "dana@example.test", sender, ...env, preSend: { proceed: true, outcome: "proceed" } };
    expect(commsEmailReadiness(ready)).toEqual({ eligible: true, state: "ready", reason: "READY_FOR_GOVERNED_REVIEW", provider_execution_verified: false });
    expect(commsEmailReadiness({ ...ready, recipient: null }).reason).toBe("RECIPIENT_EMAIL_MISSING");
    expect(commsEmailReadiness({ ...ready, sender: null, senderChoices: 2 }).reason).toBe("SENDER_CHOICE_REQUIRED");
    expect(commsEmailReadiness({ ...ready, sender: null }).reason).toBe("TENANT_EMAIL_SENDER_MISSING");
    expect(commsEmailReadiness({ ...ready, resendConfigured: false }).reason).toBe("EMAIL_PROVIDER_NOT_CONFIGURED");
    expect(commsEmailReadiness({ ...ready, preSend: undefined }).reason).toBe("RECIPIENT_PREFERENCES_UNVERIFIED");
    for (const [outcome, reason, door] of [["blocked_suppressed", "BLOCKED_SUPPRESSED", "refused"], ["blocked_client_dnd", "BLOCKED_CLIENT_DND", "refused"], ["queued_tenant_dnd", "QUEUED_TENANT_DND", "held"], ["queued_quiet_hours", "QUEUED_QUIET_HOURS", "held"], ["error", "RECIPIENT_PREFERENCES_UNVERIFIED", "held"]] as const) {
      const r = commsEmailReadiness({ ...ready, preSend: { proceed: false, outcome } });
      expect(r).toMatchObject({ eligible: false, state: "held", reason });
      expect(commsEmailReadinessOutcome(r)).toBe(door);
    }
    expect(JSON.stringify(commsEmailReadiness(ready))).not.toContain("example.test");
  });
});

describe("outward results", () => {
  it("carry no provider id, provider name, attempts or error text, and never claim delivery", () => {
    const safe = commsEmailSafeResult({ ok: true, outcome: "provider_accepted", operation_id: id, message_id: id, provider_receipt_available: true, provider: "resend", provider_message_id: "re_secret", attempts: 2, error: "boom", delivery_confirmed: true });
    expect(safe).toEqual({ ok: true, outcome: "provider_accepted", operation_id: id, message_id: id, provider_receipt_available: true, delivery_confirmed: false });
    expect(commsEmailSafeResult({ ok: false, outcome: "unknown" })).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED", provider_receipt_available: false });
    expect(commsEmailSafeResult({ outcome: "refused", reason: "blocked_suppressed" })).toMatchObject({ outcome: "refused", reason: "BLOCKED_SUPPRESSED" });
    expect(commsEmailSafeResult({ outcome: "failed", reason: "resend_500: {\"secret\":1}" })).not.toHaveProperty("reason");
  });
});

describe("honest residuals and gates", () => {
  it("the Spine idempotency text states the Gmail/SMTP and send-time residuals", () => {
    const text = COMMS_EMAIL_SEND.action!.idempotency;
    expect(text).toMatch(/Gmail and SMTP have no provider idempotency/);
    expect(text).toMatch(/never auto-reconciled/);
    expect(text).toMatch(/blocks only an identical resend/);
    expect(text).toMatch(/SMTP returns no provider receipt/);
    expect(text).toMatch(/reported only as unknown, never as accepted/);
    expect(text).toMatch(/from_name and reply_to are read at send time/);
  });

  it("the receipt ledger does not claim coverage the MCP senders of comms_send_email do not have", () => {
    const ledger = JSON.parse(readFileSync("scripts/ci/receipt-coverage-ledger.json", "utf8")) as { entries: { tool: string; receipt: string; evidence?: string }[] };
    const entry = ledger.entries.find(e => e.tool === COMMS_EMAIL_TOOL)!;
    const policy = readFileSync("supabase/functions/_shared/paige-mcp/capability-policy.ts", "utf8");
    const producers = [...policy.matchAll(/^\s{2}([a-z_]+): \{\n\s+canonical: "comms_send_email",/gm)].map(m => m[1]).sort();
    expect(producers).toEqual(["send_composed_email", "send_transactional_email"]);
    const mcpEmits = /record_capability_run|recordCapabilityRun/.test(readFileSync("supabase/functions/paige-mcp/index.ts", "utf8"));
    // `emits` would assert every producer of the key writes a receipt; it is true only if the MCP ones do.
    if (!mcpEmits) expect(entry.receipt).not.toBe("emits");
    expect(entry.evidence).toMatch(/comms-email-command/);
    for (const p of producers) expect(entry.evidence).toContain(p);
  });

  it("the comms-email shared suites run under the config the CI invoice step runs", async () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("vitest.mjs run --config vitest.sales-invoice-delivery.config.ts");
    const config = (await import("../../vitest.sales-invoice-delivery.config")).default as { test: { include: string[] } };
    const files = readdirSync("supabase/functions/_shared/comms-email").filter(f => f.endsWith(".test.ts")).map(f => `supabase/functions/_shared/comms-email/${f}`);
    expect(files.length).toBeGreaterThanOrEqual(3);
    const match = picomatch(config.test.include);
    for (const f of files) expect(match(f), f).toBe(true);
  });
});
