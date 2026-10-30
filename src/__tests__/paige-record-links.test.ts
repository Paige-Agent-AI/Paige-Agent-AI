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
describe("Marketing surface reference", () => {
  it("persists only the closed destination, discarding source labels, record IDs and injected destinations", () => {
    const saved = JSON.parse(JSON.stringify([
      { destination: "marketing", record_id: A, subject: "Private campaign", account: "other",
        path: "/solo/1/growth/overview", url: "https://other.invalid", campaign: A },
    ]));
    expect(readRecordLinks(saved)).toEqual([{ destination: "marketing", record_id: null }]);
    expect(readRecordLinks([{ destination: "/growth/overview" }, { destination: "marketing?account=other" }])).toEqual([]);
  });
  it("deduplicates the new surface without increasing the shared six-reference limit", () => {
    expect(mergeRecordLinks([{ destination: "marketing", record_id: A }],
      [{ destination: "marketing", record_id: null }, { destination: "executive" }]))
      .toEqual([{ destination: "marketing", record_id: null }, { destination: "executive", record_id: null }]);
    const destinations = ["executive", "finance", "sales_pipeline", "contacts", "sales_collections", "systems_check", "marketing"];
    expect(readRecordLinks(destinations.map(destination => ({ destination })))).toHaveLength(6);
    expect(readRecordLinks(destinations.map(destination => ({ destination }))).some(link => link.destination === "marketing")).toBe(false);
  });
});
const B = "e4000000-0000-4000-8000-0000000c0002";

describe("typed original Planning work references", () => {
  it("keeps Planning distinct from a CRM task with the same UUID through persistence and deduplication", () => {
    const planning = { destination: "operations_work", record_id: A, record_kind: "planning_item" };
    const crm = { destination: "operations_work", record_id: A };
    expect(readRecordLinks(JSON.parse(JSON.stringify([
      { ...planning, subject: "Private title", tenant: "foreign", url: "https://foreign.invalid", approved: true }, crm, planning,
    ])))).toEqual([planning, crm]);
    expect(mergeRecordLinks([crm], [planning, crm])).toEqual([crm, planning]);
  });
  it("rejects unknown or misplaced record kinds instead of silently reinterpreting them as CRM", () => {
    for (const record_kind of ["crm_task", "plan_items", "", null, {}, ["planning_item"]]) {
      expect(readRecordLinks([{ destination: "operations_work", record_id: A, record_kind }])).toEqual([]);
    }
    expect(readRecordLinks([{ destination: "contacts", record_id: A, record_kind: "planning_item" }])).toEqual([]);
  });
});

it("retains a Systems Check finding UUID through the original reference frame without source text or authority", () => {
  const persisted = JSON.parse(JSON.stringify([{ destination: "systems_check", record_id: A.toUpperCase(),
    path: "/foreign", account: "other", subject: "Private finding", approved: true }]));
  expect(readRecordLinks(persisted)).toEqual([{ destination: "systems_check", record_id: A }]);
  expect(readRecordLinks([{ destination: "systems_check", record_id: "../foreign" }]))
    .toEqual([{ destination: "systems_check", record_id: null }]);
});

describe("readRecordLinks — the defensive reader for live frames and persisted bundle_ref", () => {
  it("retains the existing destinations and admits the bounded owner Portal Knowledge reference", () => {
    expect([...READ_LINK_DESTINATIONS]).toEqual([
      "contacts", "sales_agreements", "sales_invoices", "sales_collections", "operations_work", "team_hub", "business_time_zone",
      "executive", "finance", "marketing", "sales_pipeline", "systems_check", "business_game_plan", "trust_compass", "mind", "portal_knowledge", "calendar", "pipeline", "conversations",
    ]);
  });

  it("persists only a surface reference for Conversations, discarding private or supplied focus", () => {
    const frame = readRecordLinks([
      { destination: "conversations", record_id: A, subject: "Private subject", thread_key: "private@example.invalid", path: "/solo/1/clients/conversations", url: "https://foreign.invalid", account: 1 },
      { destination: "conversations", record_id: B },
    ]);
    expect(frame).toEqual([{ destination: "conversations", record_id: null }]);
    expect(readRecordLinks(JSON.parse(JSON.stringify(frame)))).toEqual(frame);
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
  it("round-trips an exact Play reference without retaining an old account, address or subject", () => {
    const persisted = JSON.parse(JSON.stringify({ record_links: [{ destination: "business_game_plan", record_id: A,
      subject: "Private Play", url: "/solo/old/command-center/business-game-plan", account: "old" }] }));
    expect(readRecordLinks(persisted.record_links)).toEqual([{ destination: "business_game_plan", record_id: A }]);
    expect(readRecordLinks([{ destination: "business_game_plan", record_id: "../foreign" }]))
      .toEqual([{ destination: "business_game_plan", record_id: null }]);
  });
});

 it("keeps only an original Knowledge UUID, without supplied identity, source text or publication claims",()=>{
  expect(readRecordLinks([{destination:"portal_knowledge",record_id:A.toUpperCase(),subject:"Private source",tenant:"foreign",actor:"other",url:"https://foreign.invalid",published:true}])).toEqual([{destination:"portal_knowledge",record_id:A}]);
  expect(readRecordLinks([{destination:"portal_knowledge",record_id:"invalid"},{destination:"portal_knowledge?published=true",record_id:A}])).toEqual([{destination:"portal_knowledge",record_id:null}]);
 });
