// The TypeScript half of the E09 Slice 6 consent parity proof (M8). It reads the SAME fixture the
// pgTAP file supabase/tests/customer_portal_consent_parity.sql is generated from
// (scripts/ci/consent-parity-gen.mjs), so the send gate and the preference cards cannot drift apart:
//   - normalizeAddress against the 30 recorded normalizer expectations (the SQL port is held to the
//     same list);
//   - runPreSend's disposition for an email and a text to the client's primary address, and
//     tenantConsent for marketing email, against each case's recorded rows.
// Runs under `node --test` and `deno test --allow-read`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAddress, runPreSend } from "./pre-send-pipeline.ts";
import { tenantConsent } from "./tenant-consent.ts";

type Row = {
  table: "suppression" | "event"; channel: "email" | "sms"; key: "contact" | "address" | "both";
  reason?: string; source: string; action?: string; topic?: string | null; at: number;
  /** A raw address used instead of the client's primary one (the shape a merge leaves). */
  address?: string;
};
type Fixture = {
  client: { email: string; phone: string };
  normalizer: { channel: "email" | "sms"; input: string; expect: string }[];
  cases: { name: string; rows: Row[]; expect: Record<string, string | null> }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/consent-parity.json", import.meta.url), "utf8"),
);

const TENANT = "e0972000-0000-4000-8000-000000000001";
const CLIENT = "e0973000-0000-4000-8000-000000000001";
const BASE = Date.parse("2026-10-01T00:00:00Z");
// Noon in New York: no quiet-hours queue, so the disposition is the suppression/consent answer.
const NOON = new Date("2026-10-18T16:00:00Z");

type Rec = Record<string, unknown>;

/** A PostgREST stand-in over the case's rows: eq, the runPreSend `or(contact_id.eq.X,address_normalized.eq.Y)`,
 *  order by created_at desc, limit, maybeSingle. Anything it does not understand fails the test loudly. */
function admin(rows: Row[]) {
  const tables: Record<string, Rec[]> = {
    paige_suppressions: [], paige_consent_events: [], clients: [], tenant_comms_preferences: [],
  };
  for (const r of rows) {
    const rec: Rec = {
      id: `${r.table}-${r.at}-${r.channel}`,
      tenant_id: TENANT,
      contact_id: r.key === "address" ? null : CLIENT,
      address_normalized: r.key === "contact" ? null
        : normalizeAddress(r.channel, r.address ?? (r.channel === "sms" ? fixture.client.phone : fixture.client.email)),
      channel: r.channel,
      created_at: new Date(BASE + r.at * 60_000).toISOString(),
    };
    if (r.table === "suppression") tables.paige_suppressions.push({ ...rec, reason: r.reason, source: r.source });
    else tables.paige_consent_events.push({ ...rec, action: r.action, source: r.source, topic: r.topic ?? null });
  }
  tables.clients.push({ id: CLIENT, tenant_id: TENANT, dnd_active: false, dnd_until: null, dnd_reason: null, timezone: null });
  return {
    from(table: string) {
      const data = tables[table];
      assert.ok(data, `unexpected table ${table}`);
      const preds: ((r: Rec) => boolean)[] = [];
      let desc = false;
      const run = (n?: number) => {
        let hit = data.filter((r) => preds.every((p) => p(r)));
        if (desc) hit = [...hit].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return n === undefined ? hit : hit.slice(0, n);
      };
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { preds.push((r) => r[col] === val); return q; },
        or: (expr: string) => {
          const alts = expr.split(",").map((part) => {
            const m = /^([a-z_]+)\.eq\.(.+)$/.exec(part);
            assert.ok(m, `unexpected or() filter ${part}`);
            return (r: Rec) => r[m[1]] === m[2];
          });
          preds.push((r) => alts.some((a) => a(r)));
          return q;
        },
        order: (col: string, opts?: { ascending?: boolean }) => { assert.equal(col, "created_at"); desc = opts?.ascending === false; return q; },
        limit: (n: number) => Promise.resolve({ data: run(n), error: null }),
        maybeSingle: () => Promise.resolve({ data: run(1)[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

describe("consent parity: the TypeScript deciders against the shared fixture", () => {
  it("has a fixture to test", () => {
    assert.equal(fixture.normalizer.length, 30);
    assert.ok(fixture.cases.length >= 22);
  });

  for (const n of fixture.normalizer) {
    it(`normalizes ${n.channel} ${JSON.stringify(n.input)}`, () => {
      assert.equal(normalizeAddress(n.channel, n.input), n.expect);
    });
  }

  for (const c of fixture.cases) {
    it(`${c.name}: runPreSend and tenantConsent match the recorded dispositions`, async () => {
      const a = admin(c.rows);
      const db = a as unknown as Parameters<typeof runPreSend>[0] & Parameters<typeof tenantConsent>[0];
      const email = await runPreSend(db, { tenantId: TENANT, channel: "email", to: fixture.client.email, contactId: CLIENT, now: NOON });
      const sms = await runPreSend(db, { tenantId: TENANT, channel: "sms", to: fixture.client.phone, contactId: CLIENT, now: NOON });
      assert.equal(email.outcome, c.expect.presend_email, "email disposition");
      assert.equal(sms.outcome, c.expect.presend_sms, "sms disposition");
      assert.equal(await tenantConsent(db, { tenantId: TENANT, channel: "email", contactId: CLIENT, address: fixture.client.email }),
        c.expect.tenant_consent_email, "tenantConsent");
    });

    // The fixture's own expectations must agree with each other the way the card promises: a card
    // that says "off" means the send gate blocks it, and "on" means it does not.
    it(`${c.name}: the card states and the send dispositions tell one story`, () => {
      const e = c.expect;
      assert.equal(e.email === "off", e.presend_email === "blocked_suppressed", "email card vs gate");
      assert.equal(e.sms === "on", e.presend_sms === "proceed", "texts card vs gate");
      if (e.updates === "subscribed") assert.equal(e.tenant_consent_email, "granted", "subscribed needs both deciders");
    });
  }
});
