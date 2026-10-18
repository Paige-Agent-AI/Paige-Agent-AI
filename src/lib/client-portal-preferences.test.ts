import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
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
  ])("refuses %s", (_label, over) => {
    const row: Record<string, unknown> = prefs(over as Record<string, unknown>);
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    expect(readClientPortalPreferences(row)).toBeNull();
  });
  it("refuses null, arrays and strings", () => {
    for (const v of [null, [], "x", 1]) expect(readClientPortalPreferences(v)).toBeNull();
  });
  it("accepts every server state and setter, including a sign-up form and the no-address Updates state", () => {
    const row = prefs({ email: card("off", { set_by: "form", set_at: "2026-10-01T00:00:00Z" }), sms: card("no_number"),
      updates: { state: "no_address", set_by: null, set_at: null, can_subscribe: false, can_unsubscribe: false } });
    expect(readClientPortalPreferences(row)?.email.set_by).toBe("form");
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
  it("fills the business name everywhere it appears", () => {
    const text = disclosureText("sms-pref:v1", "Northwind Studio");
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
