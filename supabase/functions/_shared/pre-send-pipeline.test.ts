// runPreSend's human-readable reasons (E09 Slice 6): a portal opt-out has its own plain sentence, and the
// existing reasons are unchanged. The suppression/consent dispositions themselves are pinned against the
// shared fixture in consent-parity.test.ts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPreSend } from "./pre-send-pipeline.ts";

function admin(reason: string) {
  return {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, or: () => q, order: () => q,
        limit: async () => ({ data: table === "paige_suppressions" ? [{ id: "s1", reason }] : [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return q;
    },
  };
}

describe("runPreSend suppression reasons", () => {
  const cases: [string, string][] = [
    ["customer_request", "This contact turned off messages on this channel."],
    ["user_stop", "This contact replied STOP and can't be messaged."],
    ["unsubscribe_link", "This contact unsubscribed and can't be messaged."],
    ["complaint", "This contact reported a previous message, so we won't message them."],
    ["bounce_hard", "This address is undeliverable, so we won't retry it."],
    ["manual", "This contact is on the do-not-message list."],
  ];
  for (const [reason, sentence] of cases) {
    it(`${reason} blocks with its own sentence`, async () => {
      const r = await runPreSend(admin(reason) as unknown as Parameters<typeof runPreSend>[0], { tenantId: "t", channel: "email", to: "a@tests.invalid", contactId: null });
      assert.equal(r.outcome, "blocked_suppressed");
      assert.equal(r.reason, sentence);
    });
  }
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
function dispatchFixture(options: { timezone?: unknown; finalTimezone?: unknown; verified?: unknown; clientMissing?: boolean; clientError?: boolean; consent?: string; suppressed?: boolean; tenantTimezone?: string } = {}) {
  let clientReads = 0;
  return { from(table: string) {
    const q = {
      select: () => q, eq: () => q, or: () => q, order: () => q,
      limit: async () => ({ data: table === "paige_suppressions" ? options.suppressed ? [{ id: "suppression", reason: "user_stop" }] : [] : [{ action: options.consent ?? "granted" }], error: null }),
      maybeSingle: async () => table === "clients" ? { data: options.clientMissing ? null : { dnd_active: false, timezone_verified: Object.hasOwn(options, "verified") ? options.verified : true, timezone: ++clientReads > 1 && Object.hasOwn(options, "finalTimezone") ? options.finalTimezone : options.timezone }, error: options.clientError ? { message: "synthetic unavailable" } : null }
        : { data: { autosend_dnd_enabled: false, autosend_dnd_timezone: options.tenantTimezone ?? "America/New_York" }, error: null },
    };
    return q;
  } } as unknown as Parameters<typeof runPreSend>[0];
}
const sms = { tenantId: TENANT, contactId: CONTACT, channel: "sms" as const, to: "+12025550123", now: new Date("2026-10-30T16:00:00Z") };
function changingDndFixture(final: { active: boolean; until?: string; reason?: string }, suppressed = false) {
  const fallback = dispatchFixture({ timezone: "America/New_York", suppressed });
  let reads = 0;
  const selections: string[] = [];
  const scopedReads: Record<string, unknown>[] = [];
  const client = { from(table: string) {
    if (table !== "clients") return fallback.from(table);
    let selected = "";
    const filters: Record<string, unknown> = {};
    const q = {
      select(fields: string) { selected = fields; selections.push(fields); return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      async maybeSingle() {
        scopedReads.push(filters);
        const current = ++reads > 1;
        const row: Record<string, unknown> = { timezone: "America/New_York", timezone_verified: true,
          dnd_active: current && final.active, dnd_until: current ? final.until ?? null : null,
          dnd_reason: current ? final.reason ?? null : null };
        return { data: Object.fromEntries(selected.split(",").map(key => [key, row[key]])), error: null };
      },
    };
    return q;
  } } as unknown as Parameters<typeof runPreSend>[0];
  return { client, selections, scopedReads };
}
describe("SMS recipient hold currentness after consent and preferences", () => {
  for (const until of [undefined, "2026-10-31T16:00:00Z"]) it(`honors a newly active hold (${until ?? "indefinite"})`, async () => {
    const f = changingDndFixture({ active: true, until, reason: "Please wait until our meeting." });
    const r = await runPreSend(f.client, sms);
    assert.deepEqual(r, { proceed: false, outcome: "blocked_client_dnd", reason: "Please wait until our meeting.", queueUntil: null });
    assert.equal(f.selections.length, 2);
    assert(f.selections[1].includes("dnd_active"));
    assert.deepEqual(f.scopedReads, [{ id: CONTACT, tenant_id: TENANT }, { id: CONTACT, tenant_id: TENANT }]);
  });
  it("keeps the existing expired-hold behavior", async () => {
    assert.equal((await runPreSend(changingDndFixture({ active: true, until: "2026-10-29T16:00:00Z" }).client, sms)).proceed, true);
  });
  it("retains an explicit existing DND override", async () => {
    assert.equal((await runPreSend(changingDndFixture({ active: true }).client, { ...sms, overrideClientDnd: true })).proceed, true);
  });
  it("does not let the DND override bypass suppression", async () => {
    const r = await runPreSend(changingDndFixture({ active: true }, true).client, { ...sms, overrideClientDnd: true });
    assert.equal(r.outcome, "blocked_suppressed"); assert.equal(r.proceed, false);
  });
  it("retains email's original read and behavior", async () => {
    const f = changingDndFixture({ active: true });
    assert.equal((await runPreSend(f.client, { ...sms, channel: "email", to: "a@tests.invalid" })).proceed, true);
    assert.equal(f.selections.length, 1);
  });
});
describe("SMS dispatch requires the recipient's known timezone", () => {
  for (const verified of [false, undefined, null, "true"]) it(`refuses an unconfirmed recipient zone (${String(verified)})`, async () => {
    const r = await runPreSend(dispatchFixture({ timezone: "America/New_York", verified }), sms);
    assert.equal(r.proceed, false); assert.equal(r.outcome, "error"); assert.equal(r.queueUntil, null);
  });
  for (const [label, options] of [
    ["missing", {}], ["null", { timezone: null }], ["blank", { timezone: " " }],
    ["invalid", { timezone: "not/a-zone" }], ["non-string", { timezone: 7 }],
    ["UTC is not a recipient location", { timezone: "UTC" }], ["fixed offset", { timezone: "Etc/GMT+5" }], ["abbreviation", { timezone: "EST" }],
    ["missing contact", { clientMissing: true }], ["failed contact read", { clientError: true }],
    ["tenant zone cannot supply recipient location", { tenantTimezone: "Pacific/Honolulu" }],
  ] as const) it(`holds ${label} without inventing a release time`, async () => {
    const r = await runPreSend(dispatchFixture(options), sms);
    assert.equal(r.proceed, false); assert.equal(r.outcome, "error"); assert.equal(r.queueUntil, null);
    assert.match(r.reason ?? "", /recipient.*time zone/i);
  });
  it("does not infer the recipient timezone from their phone number", async () => {
    const r = await runPreSend(dispatchFixture(), { ...sms, contactId: null });
    assert.equal(r.proceed, false); assert.equal(r.queueUntil, null);
  });
  it("keeps suppression and revoked consent ahead of location recovery", async () => {
    assert.equal((await runPreSend(dispatchFixture({ suppressed: true }), sms)).outcome, "blocked_suppressed");
    assert.equal((await runPreSend(dispatchFixture({ consent: "revoked" }), sms)).outcome, "blocked_no_consent");
  });
  it("retains email behavior without imposing SMS location requirements", async () => {
    assert.equal((await runPreSend(dispatchFixture(), { ...sms, channel: "email", to: "a@tests.invalid" })).proceed, true);
  });
  it("rechecks location on queue re-entry after a contact changes", async () => {
    assert.equal((await runPreSend(dispatchFixture({ timezone: "America/New_York" }), sms)).proceed, true);
    assert.equal((await runPreSend(dispatchFixture({ timezone: null }), sms)).proceed, false);
  });
  it("does not keep the old location while consent and preferences were awaited", async () => {
    assert.equal((await runPreSend(dispatchFixture({ timezone: "America/New_York", finalTimezone: null }), sms)).proceed, false);
    const r = await runPreSend(dispatchFixture({ timezone: "America/New_York", finalTimezone: "Pacific/Honolulu" }), { ...sms, now: new Date("2026-10-30T13:00:00Z") });
    assert.equal(r.proceed, false); assert.equal(r.queueUntil, "2026-10-30T18:00:00.000Z");
  });
  for (const [instant, expected, release] of [
    ["2026-10-30T11:59:00Z", false, "2026-10-30T12:00:00.000Z"],
    ["2026-10-30T12:00:00Z", true, null],
    ["2026-10-31T00:00:00Z", false, "2026-10-31T12:00:00.000Z"],
    ["2026-11-01T12:59:00Z", false, "2026-11-01T13:00:00.000Z"],
    ["2026-11-01T13:00:00Z", true, null],
  ] as const) it(`preserves the existing known-zone boundary at ${instant}`, async () => {
    const r = await runPreSend(dispatchFixture({ timezone: "America/New_York" }), { ...sms, now: new Date(instant) });
    assert.equal(r.proceed, expected); assert.equal(r.queueUntil, release);
  });
});
