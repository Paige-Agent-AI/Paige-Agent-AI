import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stageAutomationGate } from "./gate.ts";

const T = "tenant-a";
const C = "client-1";
type Rec = Record<string, unknown>;

// The service client the dispatcher holds: clients (with embedded methods), paige_suppressions and
// paige_consent_events, each answering exact-match filters the way PostgREST would.
function db(opts: { suppressions?: Rec[]; events?: Rec[]; fail?: string; foreignClient?: boolean } = {}) {
  const tables: Record<string, Rec[]> = {
    clients: [{
      id: C, tenant_id: opts.foreignClient ? "tenant-b" : T, linked_user_id: null,
      client_contact_methods: [
        { kind: "email", value: "Jordan.Rivera@Tests.invalid", label: null, is_primary: true, position: 0 },
        { kind: "phone", value: "(555) 010-0001", label: null, is_primary: true, position: 1 },
      ],
    }],
    paige_suppressions: (opts.suppressions ?? []).map((r) => ({ tenant_id: T, ...r })),
    paige_consent_events: (opts.events ?? []).map((r) => ({ tenant_id: T, ...r })),
  };
  return {
    from(table: string) {
      const filter: Rec = {};
      const rows = () => (tables[table] ?? []).filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
      const fail = opts.fail === table;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filter[k] = v; return q; },
        order: () => q,
        limit: async () => fail ? { data: null, error: { message: "boom" } }
          : { data: rows().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), error: null },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

const rule = (compose_intent: "transactional" | "marketing" | "nurture" | "notification") => ({ compose_intent });
const granted = { contact_id: C, channel: "email", action: "granted", created_at: "2026-10-01T00:00:00Z" };

describe("stage automation gate", () => {
  it("a contact who turned email off in the portal is skipped for a non-marketing intent", async () => {
    const d = await stageAutomationGate(db({ suppressions: [{ contact_id: C, channel: "email", reason: "customer_request", source: "customer_portal" }] }),
      { tenant_id: T, contact_id: C, rule: rule("transactional") });
    assert.deepEqual(d, { kind: "skip", status: "skipped_no_consent", reason: "contact_opted_out", error: "contact opted out: email" });
  });

  it("and for a marketing intent, even with marketing consent on record", async () => {
    const d = await stageAutomationGate(db({ suppressions: [{ address_normalized: "+15550100001", channel: "sms", reason: "user_stop", source: "inbound_message" }], events: [granted] }),
      { tenant_id: T, contact_id: C, rule: rule("marketing") });
    assert.equal(d.kind, "skip");
    assert.equal(d.kind === "skip" && d.reason, "contact_opted_out");
  });

  it("an unsubscribe found only by the normalized address still skips", async () => {
    const d = await stageAutomationGate(db({ suppressions: [{ address_normalized: "jordan.rivera@tests.invalid", channel: "email", reason: "unsubscribe_link", source: "webhook" }] }),
      { tenant_id: T, contact_id: C, rule: rule("notification") });
    assert.equal(d.kind === "skip" && d.reason, "contact_opted_out");
  });

  it("a business pause does not skip, but the payload names the paused channel", async () => {
    const d = await stageAutomationGate(db({ suppressions: [{ contact_id: C, channel: "sms", reason: "manual", source: "admin_ui" }] }),
      { tenant_id: T, contact_id: C, rule: rule("transactional") });
    assert.deepEqual(d, { kind: "send", optedOutChannels: ["sms"] });
  });

  it("a contact with no opt-outs is unchanged: transactional sends, marketing needs consent", async () => {
    assert.deepEqual(await stageAutomationGate(db(), { tenant_id: T, contact_id: C, rule: rule("transactional") }), { kind: "send", optedOutChannels: [] });
    assert.equal((await stageAutomationGate(db(), { tenant_id: T, contact_id: C, rule: rule("nurture") })).kind, "skip");
    assert.deepEqual(await stageAutomationGate(db({ events: [granted] }), { tenant_id: T, contact_id: C, rule: rule("marketing") }), { kind: "send", optedOutChannels: [] });
  });

  it("an unreadable suppression ledger holds the automation", async () => {
    const d = await stageAutomationGate(db({ fail: "paige_suppressions" }), { tenant_id: T, contact_id: C, rule: rule("transactional") });
    assert.equal(d.kind === "skip" && d.reason, "opt_outs_unknown");
  });

  it("another business's contact is never read for opt-outs (and transactional is unchanged)", async () => {
    const d = await stageAutomationGate(db({ foreignClient: true, suppressions: [{ contact_id: C, channel: "email", reason: "customer_request", source: "customer_portal" }] }),
      { tenant_id: T, contact_id: C, rule: rule("transactional") });
    assert.deepEqual(d, { kind: "send", optedOutChannels: [] });
  });
});
