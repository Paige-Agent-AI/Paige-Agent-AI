// INT-328 — party resolution and the readiness reader against an in-memory service client.
import { describe, it, expect } from "vitest";
import { resolveCommsEmailParties, readEmailSenderFacts, readCommsEmailReadiness as readWith, type CommsEmailAdmin } from "./readiness.ts";
import { readFileSync } from "node:fs";
const preSend = { result: { proceed: true, outcome: "proceed" } as { proceed: boolean; outcome: string }, calls: [] as unknown[] };
const check = async (_admin: never, input: unknown) => { preSend.calls.push(input); return preSend.result; };
const readCommsEmailReadiness = (...args: [Parameters<typeof readWith>[0], Parameters<typeof readWith>[1], Parameters<typeof readWith>[2]]) => readWith(...args, check);

const T = "10000000-0000-4000-8000-000000000001", F = "10000000-0000-4000-8000-000000000002";
const C = "30000000-0000-4000-8000-000000000001", S1 = "50000000-0000-4000-8000-000000000001", S2 = "50000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;
function admin(tables: Record<string, Row[]>, fail = false): CommsEmailAdmin & { reads: { table: string; filters: [string, unknown][] }[] } {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  return { reads, from: (table: string) => ({ select: () => {
    const filters: [string, unknown][] = []; reads.push({ table, filters });
    const rows = () => (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v));
    const q = { eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      maybeSingle: async () => fail ? { data: null, error: { code: "XX" } } : { data: rows()[0] ?? null, error: null },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(fail ? { data: null, error: { code: "XX" } } : { data: rows(), error: null }).then(res, rej) };
    return q as never;
  } }) };
}
const contact = { id: C, tenant_id: T, first_name: "Dana", last_name: "Reyes", client_contact_methods: [{ kind: "email", value: "second@x.test", is_primary: false, position: 0 }, { kind: "email", value: " Primary@X.test", is_primary: true, position: 1 }] };
const conn = (id: string, extra: Row = {}) => ({ id, tenant_id: T, channel_type: "email", provider: "resend", from_address: "Owner@Biz.test", active: true, status: "active", credentials_vault_ref: null, config: {}, ...extra });

describe("resolveCommsEmailParties", () => {
  it("reads the contact only inside the server tenant and picks its PRIMARY email", async () => {
    const a = admin({ clients: [contact], channel_connectors: [conn(S1)] });
    expect(await resolveCommsEmailParties(a, { tenantId: T, contactId: C, connectorId: null })).toEqual({ kind: "resolved", contactId: C, contactName: "Dana Reyes", recipient: "primary@x.test", connectorId: S1, fromAddress: "owner@biz.test" });
    expect(a.reads[0]).toEqual({ table: "clients", filters: [["id", C], ["tenant_id", T]] });
  });
  it("a contact of another workspace is not found, whatever id the caller passes", async () => {
    const a = admin({ clients: [{ ...contact, tenant_id: F }], channel_connectors: [conn(S1)] });
    expect((await resolveCommsEmailParties(a, { tenantId: T, contactId: C, connectorId: null })).kind).toBe("contact_not_in_workspace");
  });
  it("no primary email is a missing recipient, never a guessed one", async () => {
    const a = admin({ clients: [{ ...contact, client_contact_methods: [{ kind: "email", value: "second@x.test", is_primary: false, position: 0 }] }], channel_connectors: [conn(S1)] });
    expect((await resolveCommsEmailParties(a, { tenantId: T, contactId: C, connectorId: null })).kind).toBe("recipient_missing");
  });
  it("zero senders needs setup; two is a choice; a named foreign sender is missing", async () => {
    expect((await resolveCommsEmailParties(admin({ clients: [contact], channel_connectors: [] }), { tenantId: T, contactId: C, connectorId: null })).kind).toBe("sender_missing");
    const two = await resolveCommsEmailParties(admin({ clients: [contact], channel_connectors: [conn(S2, { from_address: "b@biz.test" }), conn(S1, { from_address: "a@biz.test" })] }), { tenantId: T, contactId: C, connectorId: null });
    expect(two).toMatchObject({ kind: "sender_choice_required", senders: [{ connector_id: S1, from_address: "a@biz.test" }, { connector_id: S2, from_address: "b@biz.test" }] });
    expect((await resolveCommsEmailParties(admin({ clients: [contact], channel_connectors: [conn(S1, { tenant_id: F })] }), { tenantId: T, contactId: C, connectorId: S1 })).kind).toBe("sender_missing");
  });
  it("a read failure throws instead of answering", async () => {
    await expect(resolveCommsEmailParties(admin({}, true), { tenantId: T, contactId: C, connectorId: null })).rejects.toThrow();
  });
});

describe("readCommsEmailReadiness", () => {
  const env = (k: string) => ({ RESEND_API_KEY: "set" } as Record<string, string>)[k];
  it("is ready only after the recipient-specific pre-send check proceeds", async () => {
    preSend.calls.length = 0; preSend.result = { proceed: true, outcome: "proceed" };
    const r = await readCommsEmailReadiness(admin({ channel_connectors: [conn(S1)] }), { tenantId: T, contactId: C, recipient: "primary@x.test", connectorId: S1 }, env);
    expect(r).toMatchObject({ eligible: true, reason: "READY_FOR_GOVERNED_REVIEW" });
    expect(preSend.calls).toEqual([{ tenantId: T, channel: "email", to: "primary@x.test", contactId: C }]);
  });
  it("a suppressed recipient is held as BLOCKED_SUPPRESSED; a missing provider key never reaches pre-send", async () => {
    preSend.calls.length = 0; preSend.result = { proceed: false, outcome: "blocked_suppressed" };
    expect((await readCommsEmailReadiness(admin({ channel_connectors: [conn(S1)] }), { tenantId: T, contactId: C, recipient: "primary@x.test", connectorId: S1 }, env)).reason).toBe("BLOCKED_SUPPRESSED");
    preSend.calls.length = 0;
    expect((await readCommsEmailReadiness(admin({ channel_connectors: [conn(S1)] }), { tenantId: T, contactId: C, recipient: "primary@x.test", connectorId: S1 }, () => undefined)).reason).toBe("EMAIL_PROVIDER_NOT_CONFIGURED");
    expect(preSend.calls).toEqual([]);
  });
  it("an inactive or foreign connector is a missing sender; a read failure is unavailable", async () => {
    expect((await readCommsEmailReadiness(admin({ channel_connectors: [conn(S1, { status: "disconnected" })] }), { tenantId: T, contactId: C, recipient: "p@x.test", connectorId: S1 }, env)).reason).toBe("TENANT_EMAIL_SENDER_MISSING");
    expect((await readCommsEmailReadiness(admin({ channel_connectors: [conn(S1, { tenant_id: F })] }), { tenantId: T, contactId: C, recipient: "p@x.test", connectorId: S1 }, env)).reason).toBe("TENANT_EMAIL_SENDER_MISSING");
    expect(await readCommsEmailReadiness(admin({}, true), { tenantId: T, contactId: C, recipient: "p@x.test", connectorId: S1 }, env)).toMatchObject({ eligible: false, state: "unavailable", reason: "EMAIL_READINESS_UNVERIFIED" });
  });
});

describe("readEmailSenderFacts — the one connector sender-fact read", () => {
  it("reads only reference presence, tenant- and email-filtered, and maps the facts", async () => {
    const a = admin({ channel_connectors: [conn(S1, { credentials_vault_ref: "vault-ref", provider: "smtp", config: { host: "smtp.x.test", port: 587, password: "never-read" } })] });
    expect(await readEmailSenderFacts(a, T, S1)).toEqual({ tenantMatches: true, active: true, provider: "smtp", fromAddress: "Owner@Biz.test", credentialReferencePresent: true, smtpConfigured: true });
    expect(a.reads).toEqual([{ table: "channel_connectors", filters: [["tenant_id", T], ["id", S1], ["channel_type", "email"]] }]);
    expect(await readEmailSenderFacts(admin({ channel_connectors: [conn(S1, { status: "disconnected" })] }), T, S1)).toMatchObject({ active: false });
  });
  it("no row is null (a missing sender), a read failure throws", async () => {
    expect(await readEmailSenderFacts(admin({ channel_connectors: [conn(S1, { tenant_id: F })] }), T, S1)).toBeNull();
    await expect(readEmailSenderFacts(admin({}, true), T, S1)).rejects.toThrow();
  });
  it("comms readiness reads its sender through it, with no second copy of the select", () => {
    const comms = readFileSync("supabase/functions/_shared/comms-email/readiness.ts", "utf8");
    expect(comms).toContain("await readEmailSenderFacts(admin, input.tenantId, input.connectorId)");
    expect(comms.match(/credentials_vault_ref,config/g)).toHaveLength(1);
  });
});
