import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_DISCLOSURE,
  PORTAL_PREFERENCE_DISCLOSURES,
  disclosureText,
  preferenceRefusal,
  readClientCommunicationState,
  readClientPortalPreferences,
} from "./client-portal-preferences";

import { PREF_CONTACT as CONTACT, PREF_OTHER_TENANT as OTHER, PREF_TENANT as TENANT, ownerStatePayload as owner, prefCard as card, prefsPayload as prefs } from "@/test/fixtures/clientPortalPreferences";

describe("customer preferences read (exact keys)", () => {
  it("accepts the server shape and pins the business", () => {
    expect(readClientPortalPreferences(prefs())?.email.state).toBe("on");
    expect(readClientPortalPreferences(prefs(), TENANT)?.tenant_id).toBe(TENANT);
    expect(readClientPortalPreferences(prefs(), OTHER)).toBeNull();
  });
  it.each([
    ["a widened root", { address: "jordan@example.test" }],
    ["a missing root key", { read_at: undefined }],
    ["a widened card", { email: { ...card("on"), address_normalized: "jordan@example.test" } }],
    ["an unknown state word", { sms: card("pending") }],
    ["an unknown setter", { email: card("off", { set_by: "staff_member" }) }],
    ["a mistyped flag", { email: card("on", { can_turn_off: "yes" }) }],
    ["a wrong schema", { schema_version: 2 }],
    ["an unparseable time", { email: card("off", { set_at: "yesterday" }) }],
    ["quiet hours without the fallback zone", { quiet_hours: { start: "20:00", end: "08:00", time_zone_known: false } }],
    ["a mistyped fallback zone", { quiet_hours: { start: "20:00", end: "08:00", time_zone_known: false, fallback_time_zone: 5 } }],
  ])("refuses %s", (_label, over) => {
    const row: Record<string, unknown> = prefs(over as Record<string, unknown>);
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    expect(readClientPortalPreferences(row)).toBeNull();
  });
  it("carries the zone the send check falls back to, or none when the customer's own zone is known (round 3)", () => {
    expect(readClientPortalPreferences(prefs())?.quiet_hours.fallback_time_zone).toBe("America/New_York");
    const known = prefs({ quiet_hours: { start: "20:00", end: "08:00", time_zone_known: true, fallback_time_zone: null } });
    expect(readClientPortalPreferences(known)?.quiet_hours).toEqual({ start: "20:00", end: "08:00", time_zone_known: true, fallback_time_zone: null });
  });
  it("refuses null, arrays and strings", () => {
    for (const v of [null, [], "x", 1]) expect(readClientPortalPreferences(v)).toBeNull();
  });
  it("accepts every server state and setter, including a sign-up form and the no-address Updates state", () => {
    const row = prefs({ email: card("off", { set_by: "form", set_at: "2026-10-01T00:00:00Z" }), sms: card("no_number"),
      updates: { state: "no_address", set_by: null, set_at: null, can_subscribe: false, can_unsubscribe: false } });
    expect(readClientPortalPreferences(row)?.email.set_by).toBe("form");
  });
  it("accepts the customer's own spam report as its own setter, apart from delivery (round 2)", () => {
    const row = prefs({ email: card("off", { set_by: "reported", set_at: "2026-10-03T00:00:00Z", can_turn_on: true, can_turn_off: false }) });
    expect(readClientPortalPreferences(row)?.email.set_by).toBe("reported");
  });
});

describe("owner read", () => {
  const expected = { tenantId: TENANT, contactId: CONTACT };
  it("accepts the server shape for the record it was opened for", () => {
    expect(readClientCommunicationState(owner(), expected)?.portal_joined).toBe(true);
  });
  it.each([
    ["another business", { tenant_id: OTHER }],
    ["another client", { contact_id: "e0960000-0000-4000-8000-00000000d002" }],
    ["a widened answer", { address: "+12025550101" }],
    ["a missing flag", { dnd_active: undefined }],
  ])("refuses %s", (_label, over) => {
    const row: Record<string, unknown> = owner(over as Record<string, unknown>);
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    expect(readClientCommunicationState(row, expected)).toBeNull();
  });
});

describe("disclosures are the server's sentences, byte for byte (reviewer Minor 7)", () => {
  const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20271110100000_e09_customer_portal_profile_consent.sql"), "utf8");
  const body = sql.slice(sql.indexOf("FUNCTION public.client_portal_consent_disclosure"));
  it.each(Object.keys(PORTAL_PREFERENCE_DISCLOSURES))("%s matches client_portal_consent_disclosure", id => {
    const m = new RegExp(`WHEN '${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}' THEN '((?:[^']|'')*)'`).exec(body);
    expect(m, `no SQL literal for ${id}`).not.toBeNull();
    expect(PORTAL_PREFERENCE_DISCLOSURES[id as keyof typeof PORTAL_PREFERENCE_DISCLOSURES]).toBe(m![1].replace(/''/g, "'"));
  });
  it("every server id is known to the page", () => {
    const ids = [...body.slice(0, body.indexOf("END $$")).matchAll(/WHEN '([^']+)' THEN/g)].map(m => m[1]);
    expect(ids.sort()).toEqual(Object.keys(PORTAL_PREFERENCE_DISCLOSURES).sort());
  });
  it("the page shows v2 for email and updates: email off also unsubscribes, back on does not re-subscribe, agreements are named, the label is not repeated", () => {
    expect(CURRENT_DISCLOSURE).toEqual({ email: "email-pref:v2", sms: "sms-pref:v2", updates: "updates-optin:v2", sharing: "data-sharing:v1" });
    const email = disclosureText("email-pref:v2", "Northwind Studio");
    expect(email).toContain("except booking confirmations and agreements you're asked to sign");
    expect(email).toContain("Turning email off also unsubscribes you from updates and offers, and turning it back on doesn't subscribe you again.");
    expect(disclosureText("updates-optin:v2", "Northwind Studio")).not.toMatch(/^Updates and offers/);
  });
  it("texts v2 never says \"again\" and never implies a text will come (round 3, verifier minor 6)", () => {
    const text = disclosureText("sms-pref:v2", "Northwind Studio");
    expect(text).not.toMatch(/\bagain\b/);
    expect(text).toContain("reply START to a text from Northwind Studio if you have one, or ask them.");
  });
  // One chain, checked in CI: the page's sentence → its md5 prefix → the pin in the pgTAP file → the
  // pgTAP assertions that every writer's evidence carries that hash (customer_portal_profile_consent R3-1).
  it.each(Object.values(CURRENT_DISCLOSURE))("%s: the page's sentence hashes to the pin the database test holds every writer to", id => {
    const pgtap = fs.readFileSync(path.resolve(__dirname, "../../supabase/tests/customer_portal_profile_consent.sql"), "utf8");
    const pin = new RegExp(`client_portal_consent_disclosure\\('${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\\)\\),12\\),'([0-9a-f]{12})','pin: `).exec(pgtap);
    expect(pin, `no pgTAP hash pin for ${id}`).not.toBeNull();
    expect(createHash("md5").update(PORTAL_PREFERENCE_DISCLOSURES[id], "utf8").digest("hex").slice(0, 12)).toBe(pin![1]);
  });
  it("fills the business name everywhere it appears", () => {
    const text = disclosureText("sms-pref:v2", "Northwind Studio");
    expect(text).not.toContain("{business}");
    expect(text.match(/Northwind Studio/g)).toHaveLength(3);
  });
});

describe("writer refusals", () => {
  it("names a refusal from the envelope, and only a known one", () => {
    expect(preferenceRefusal({ ok: false, error: "EMAIL_PAUSED_BY_BUSINESS", preferences: {} }, null)).toBe("EMAIL_PAUSED_BY_BUSINESS");
    expect(preferenceRefusal({ ok: false, error: "SOMETHING_NEW" }, null)).toBe("OTHER");
    expect(preferenceRefusal({ ok: true, replayed: false }, null)).toBeNull();
  });
  it("names a raised BAD_PREFERENCE", () => {
    expect(preferenceRefusal(null, { code: "22023", message: "BAD_PREFERENCE: channel email or sms" })).toBe("BAD_PREFERENCE");
  });
});
