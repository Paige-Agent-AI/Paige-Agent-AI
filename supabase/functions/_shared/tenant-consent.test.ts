import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tenantConsent } from "./tenant-consent.ts";

type Row = { action: string; created_at: string };
type Filter = Record<string, unknown>;

// A stand-in for the service client: each read records its exact-match filters and returns the newest
// matching ledger row, the way PostgREST would.
function ledger(rows: Array<Row & Filter>, opts: { fail?: boolean; throws?: boolean } = {}) {
  const reads: Filter[] = [];
  const admin = {
    from(table: string) {
      assert.equal(table, "paige_consent_events");
      const filter: Filter = {};
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filter[col] = val; return q; },
        order: () => q,
        limit: async () => {
          if (opts.throws) throw new Error("network");
          reads.push({ ...filter });
          if (opts.fail) return { data: null, error: { message: "boom" } };
          const hit = rows
            .filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 1)
            .map(({ action, created_at }) => ({ action, created_at }));
          return { data: hit, error: null };
        },
      };
      return q;
    },
  };
  return { admin, reads };
}

const T = "tenant-a";
const base = { tenant_id: T, channel: "email" };

describe("tenant consent (the business's own ledger)", () => {
  it("allows only when the latest event for the contact or address is granted", async () => {
    const { admin } = ledger([{ ...base, contact_id: "c1", action: "granted", created_at: "2026-10-01" }]);
    assert.equal(await tenantConsent(admin, { tenantId: T, channel: "email", contactId: "c1", address: "x@y.z" }), "granted");
  });

  it("a later revocation by address beats an earlier grant by contact", async () => {
    const { admin } = ledger([
      { ...base, contact_id: "c1", action: "granted", created_at: "2026-10-01" },
      { ...base, address_normalized: "dana@example.com", action: "revoked", created_at: "2026-10-02" },
    ]);
    assert.equal(await tenantConsent(admin, { tenantId: T, channel: "email", contactId: "c1", address: "Dana+news@Example.com" }), "revoked");
  });

  it("another business's grant does not count", async () => {
    const { admin } = ledger([{ tenant_id: "tenant-b", channel: "email", contact_id: "c1", action: "granted", created_at: "2026-10-01" }]);
    assert.equal(await tenantConsent(admin, { tenantId: T, channel: "email", contactId: "c1", address: "x@y.z" }), "none");
  });

  it("a grant on another channel does not count", async () => {
    const { admin } = ledger([{ tenant_id: T, channel: "sms", contact_id: "c1", action: "granted", created_at: "2026-10-01" }]);
    assert.equal(await tenantConsent(admin, { tenantId: T, channel: "email", contactId: "c1" }), "none");
  });

  it("nothing on record is none; no contact and no address is none without a read", async () => {
    const empty = ledger([]);
    assert.equal(await tenantConsent(empty.admin, { tenantId: T, channel: "email", contactId: "c1" }), "none");
    const none = ledger([]);
    assert.equal(await tenantConsent(none.admin, { tenantId: T, channel: "email" }), "none");
    assert.equal(none.reads.length, 0);
  });

  it("an address is matched exactly and normalized, never as filter syntax", async () => {
    const { admin, reads } = ledger([]);
    await tenantConsent(admin, { tenantId: T, channel: "email", address: "  A,B@Example.com " });
    assert.deepEqual(reads, [{ tenant_id: T, channel: "email", address_normalized: "a,b@example.com" }]);
  });

  it("a ledger that cannot be read is unknown (callers hold the send)", async () => {
    assert.equal(await tenantConsent(ledger([], { fail: true }).admin, { tenantId: T, channel: "email", contactId: "c1" }), "unknown");
    assert.equal(await tenantConsent(ledger([], { throws: true }).admin, { tenantId: T, channel: "email", contactId: "c1" }), "unknown");
    assert.equal(await tenantConsent(ledger([]).admin, { tenantId: "", channel: "email", contactId: "c1" }), "unknown");
  });
});
