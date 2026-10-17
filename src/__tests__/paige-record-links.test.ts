// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  READ_LINK_DESTINATIONS,
  mergeRecordLinks,
  readRecordLinks,
} from "../../supabase/functions/_shared/paige-turn/record-links";

// Experience 04 E4-S3 — the one home of the `paige_record_links` frame. The server sends
// REFERENCES (a destination, an optional client id and its name); the client builds the address
// from the current account through the one route map. Never a path, a URL or a readback.

const A = "e4000000-0000-4000-8000-0000000c0001";
const B = "e4000000-0000-4000-8000-0000000c0002";

describe("readRecordLinks — the defensive reader for live frames and persisted bundle_ref", () => {
  it("retains the E4 destinations and admits only the bounded E2 Executive destinations", () => {
    expect([...READ_LINK_DESTINATIONS]).toEqual([
      "contacts", "sales_agreements", "sales_invoices", "sales_collections", "operations_work", "business_time_zone",
      "executive", "finance", "sales_pipeline", "systems_check", "business_game_plan", "trust_compass", "mind", "calendar", "pipeline",
    ]);
  });

  it("pipeline retains only a canonical deal UUID, without subject, URL or stored route", () => {
    expect(readRecordLinks([
      { destination: "pipeline", record_id: A.toUpperCase(), subject: "discard", url: "https://foreign.invalid", path: "/foreign" },
      { destination: "pipeline", record_id: "malformed" },
      { destination: "calendar", record_id: A },
    ])).toEqual([{ destination: "pipeline", record_id: A }, { destination: "pipeline", record_id: null }, { destination: "calendar", record_id: null }]);
  });
  it("returns nothing for anything that is not an array", () => {
    for (const v of [null, undefined, "x", 3, { destination: "contacts" }]) expect(readRecordLinks(v)).toEqual([]);
  });

  it("drops unknown destinations and malformed entries", () => {
    expect(readRecordLinks([
      { destination: "billing", record_id: null },
      { destination: "https://evil.example", record_id: null },
      null, "contacts", 4,
      { destination: "sales_invoices", record_id: null },
    ])).toEqual([{ destination: "sales_invoices", record_id: null }]);
  });

  it("keeps UUID record ids only for mounted client and invoice focus", () => {
    expect(readRecordLinks([
      { destination: "contacts", record_id: A, subject: "Acme Ltd" },
      { destination: "contacts", record_id: "x\" onload=\"alert(1)" },
      { destination: "sales_invoices", record_id: B },
    ])).toEqual([
      { destination: "contacts", record_id: A, subject: "Acme Ltd" },
      { destination: "contacts", record_id: null },
      { destination: "sales_invoices", record_id: B },
    ]);
  });

  it("flattens, strips and caps the subject at 80 characters, and keeps it only on contacts", () => {
    const long = "A".repeat(200);
    const [one, two] = readRecordLinks([
      { destination: "contacts", record_id: A, subject: `  Acme\n\u0000Ltd\u202e  ` },
      { destination: "contacts", record_id: B, subject: long },
    ]);
    expect(one.subject).toBe("Acme Ltd");
    expect(two.subject).toHaveLength(80);
    expect(readRecordLinks([{ destination: "sales_agreements", record_id: null, subject: "Acme" }]))
      .toEqual([{ destination: "sales_agreements", record_id: null }]);
    expect(readRecordLinks([{ destination: "contacts", record_id: A, subject: "   " }]))
      .toEqual([{ destination: "contacts", record_id: A }]);
  });

  it("de-duplicates by destination and record, and caps the list at six", () => {
    const many = [
      { destination: "contacts", record_id: A },
      { destination: "contacts", record_id: A, subject: "again" },
      { destination: "contacts", record_id: B },
      { destination: "sales_agreements", record_id: null },
      { destination: "sales_invoices", record_id: null },
      { destination: "sales_collections", record_id: null },
      { destination: "operations_work", record_id: null },
      { destination: "business_time_zone", record_id: null },
    ];
    const out = readRecordLinks(many);
    expect(out).toHaveLength(6);
    expect(out.filter((l) => l.destination === "contacts" && l.record_id === A)).toHaveLength(1);
    expect(out.map((l) => l.destination)).not.toContain("business_time_zone");
  });

  it("merges two rounds under the same rules", () => {
    const merged = mergeRecordLinks(
      [{ destination: "contacts", record_id: A, subject: "Acme" }],
      [{ destination: "contacts", record_id: A }, { destination: "business_time_zone", record_id: null }],
    );
    expect(merged).toEqual([
      { destination: "contacts", record_id: A, subject: "Acme" },
      { destination: "business_time_zone", record_id: null },
    ]);
  });
});
