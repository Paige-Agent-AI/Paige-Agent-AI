import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// E09 Slice 6: an owner-authored lifecycle email after a public booking must be held when the
// contact has an active pause. Contact-keyed suppressions (a business pause written by
// set_contact_channel_suppression) carry no address, so the opt-out gate needs the resolved
// contact id. bookingRow never selects contact_id, so reading it from the row always yields null.
const source = readFileSync(resolve(__dirname, "../../supabase/functions/public-booking/index.ts"), "utf8");

describe("public-booking lifecycle email opt-out gate", () => {
  const call = source.slice(source.indexOf("const guestLcEmailOk"), source.indexOf("for (const lc of createdLc)"));

  it("passes the contact resolved for this booking", () => {
    expect(call).toMatch(/emailOptOut\(admin, \{[\s\S]*contactId: contactId \?\? null,/);
  });

  it("never reads the contact from the booking row, which does not carry it", () => {
    expect(call).not.toMatch(/bookingRow[^\n]*contact_id/);
    expect(source).toMatch(/const contactId = await findOrCreateContact\(/);
  });
});
