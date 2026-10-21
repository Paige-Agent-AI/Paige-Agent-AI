// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DESTINATION_LABEL, routeLinkTarget, workspaceLinkTarget, workspaceLinkTier } from "./workspaceLinks";
import { readRecordLinks } from "../../../supabase/functions/_shared/paige-turn/record-links";

// Experience 04 E4-S3 — the one client-side home that turns a read reference into an in-app address
// and the frozen label the owner reads (chat and, later, the client record).

const UUID = "e4000000-0000-4000-8000-0000000c0001";
const soloTenant = { account_type: "standalone", parent_tenant_id: null, account_number: 3855 };
const subTenant = { account_type: "sub_account", parent_tenant_id: "e4000000-0000-4000-8000-00000000aaaa", account_number: 3856 };

describe("workspaceLinkTier — through the tier helpers, never an inline account_type compare", () => {
  it("is solo only for a top-level standalone workspace", () => {
    expect(workspaceLinkTier({ account_type: "standalone", parent_tenant_id: null })).toBe("solo");
  });
  it("is sub_account for any parented workspace, and for a top-level sub_account type", () => {
    expect(workspaceLinkTier({ account_type: "standalone", parent_tenant_id: "p" })).toBe("sub_account");
    expect(workspaceLinkTier({ account_type: "sub_account", parent_tenant_id: "p" })).toBe("sub_account");
    expect(workspaceLinkTier({ account_type: "sub_account", parent_tenant_id: null })).toBe("sub_account");
  });
  it("is null for agency, enterprise, an unresolved type and no workspace", () => {
    for (const t of [{ account_type: "agency", parent_tenant_id: null }, { account_type: "enterprise", parent_tenant_id: null },
      { account_type: null, parent_tenant_id: null }, null]) expect(workspaceLinkTier(t)).toBeNull();
  });
});

describe("DESTINATION_LABEL — the frozen words", () => {
  it("matches the cross-track contract", () => {
    expect(DESTINATION_LABEL).toEqual({
      contacts: "Open Clients",
      sales_agreements: "Open terms & agreements",
      sales_invoices: "Open invoices",
      sales_collections: "Open collections",
      operations_work: "Open delivery work",
      business_time_zone: "Open business time zone setting",
      executive: "Open Executive",
      finance: "Open Finance",
      marketing: "Open Marketing",
      sales_pipeline: "Open Sales pipeline",
      systems_check: "Open Systems Check",
      business_game_plan: "Open Business Game Plan",
      trust_compass: "Open Trust Compass",
      mind: "Open Mind",
      portal_knowledge: "Open CURA Knowledge",
      calendar: "Open Calendar",
      pipeline: "Open pipeline",
      conversations: "Open Conversations",
    });
  });
});

describe("workspaceLinkTarget", () => {
  it('reopens only a source reference in the current SOLO business, with no stored address or authority',()=>{
    const [reference]=readRecordLinks(JSON.parse(JSON.stringify([{destination:'portal_knowledge',record_id:UUID.toUpperCase(),subject:'Private source title',tenant:'foreign',url:'https://foreign.invalid',published:true}])));
    expect(reference).toEqual({destination:'portal_knowledge',record_id:UUID});
    for(const account_number of [3855,9999])expect(workspaceLinkTarget(reference,{...soloTenant,account_number})).toEqual({label:'Review CURA source',to:`/solo/${account_number}/clients/portal?view=knowledge&source=${UUID}`,status:'exact'});
    expect(workspaceLinkTarget({destination:'portal_knowledge',record_id:null},soloTenant)).toEqual({label:'Open CURA Knowledge',to:'/solo/3855/clients/portal?view=knowledge',status:'surface_only'});
    for(const tenant of [subTenant,{...soloTenant,account_type:'agency'},{...soloTenant,account_type:'enterprise'},{...soloTenant,account_number:null},null])expect(workspaceLinkTarget(reference,tenant)).toBeNull();
  });
  it("rehydrates Marketing only against the current eligible SOLO account, never campaign focus or a saved URL", () => {
    const [reference] = readRecordLinks(JSON.parse(JSON.stringify([
      { destination: "marketing", record_id: UUID, subject: "Private campaign", path: "/solo/1/growth/overview" },
    ])));
    for (const account_number of [3855, 9999]) {
      expect(workspaceLinkTarget(reference, { ...soloTenant, account_number })).toEqual({
        label: "Open Marketing", to: `/solo/${account_number}/growth/overview`, status: "surface_only",
      });
    }
    for (const tenant of [subTenant, { ...soloTenant, parent_tenant_id: "parent" },
      { ...soloTenant, account_type: "agency" }, { ...soloTenant, account_type: "enterprise" },
      { ...soloTenant, account_type: "operator" }, { ...soloTenant, account_type: null },
      { ...soloTenant, account_number: null }, { ...soloTenant, account_number: "bad/account" }, null]) {
      expect(workspaceLinkTarget(reference, tenant)).toBeNull();
    }
  });
  it("reopens a saved Conversations reference only as the current SOLO inbox", () => {
    const [reference] = readRecordLinks(JSON.parse(JSON.stringify([
      { destination: "conversations", record_id: UUID, subject: "Private subject", thread_key: "private@example.invalid", account: 1, path: "/solo/1/clients/conversations" },
    ])));
    for (const account_number of [3855, 9999]) {
      expect(workspaceLinkTarget(reference, { ...soloTenant, account_number })).toEqual({
        label: "Open Conversations", to: `/solo/${account_number}/clients/conversations`, status: "surface_only",
      });
    }
    for (const tenant of [subTenant, { ...soloTenant, parent_tenant_id: "parent" },
      { ...soloTenant, account_type: "agency" }, { ...soloTenant, account_type: "enterprise" },
      { ...soloTenant, account_type: "operator" }, { ...soloTenant, account_type: null },
      { ...soloTenant, account_number: null }, { ...soloTenant, account_number: "bad/account" }, null]) {
      expect(workspaceLinkTarget(reference, tenant)).toBeNull();
    }
  });
  it("reopens persisted Play, Deal, Task and invoice references together in the current account", () => {
    const destinations = ["business_game_plan", "pipeline", "operations_work", "sales_invoices"] as const;
    const persisted = JSON.parse(JSON.stringify(destinations.map(destination => ({
      destination, record_id: UUID.toUpperCase(), subject: "discard", url: "https://foreign.invalid", account: 3855,
    }))));
    const links = readRecordLinks(persisted);
    expect(links).toEqual(destinations.map(destination => ({ destination, record_id: UUID })));
    expect(links.map(link => workspaceLinkTarget(link, { ...soloTenant, account_number: 9999 }))).toEqual([
      { label: "Open Strategic Play", to: `/solo/9999/command-center/business-game-plan?play=${UUID}`, status: "exact" },
      { label: "Open deal", to: `/solo/9999/growth/pipeline?deal=${UUID}`, status: "exact" },
      { label: "Open task", to: `/solo/9999/operations/work?task=${UUID}`, status: "exact" },
      { label: "Open invoice", to: `/solo/9999/sales/payments?view=invoices&invoice=${UUID}`, status: "exact" },
    ]);
    // The incumbent sub-account pipeline list remains reachable, without exact focus.
    expect(links.map(link => workspaceLinkTarget(link, subTenant))).toEqual([null,
      { label: "Open pipeline", to: "/business/3856/clients/pipelines", status: "surface_only" }, null, null]);
  });
  it("canonical pipeline deal references re-resolve exact focus to the current SOLO workspace", () => {
    const reference = { destination: "pipeline" as const, record_id: UUID };
    expect(workspaceLinkTarget(reference, soloTenant)).toEqual({ label: "Open deal", to: "/solo/3855/growth/pipeline?deal=" + UUID, status: "exact" });
    expect(workspaceLinkTarget(reference, { ...soloTenant, account_number: 9999 })?.to).toBe("/solo/9999/growth/pipeline?deal=" + UUID);
    expect(workspaceLinkTarget({ ...reference, record_id: null }, soloTenant)).toEqual({ label: "Open pipeline", to: "/solo/3855/growth/pipeline", status: "surface_only" });
    expect(workspaceLinkTarget({ ...reference, record_id: "malformed" }, soloTenant)?.status).toBe("surface_only");
    expect(routeLinkTarget(reference, "solo", null)).toBeNull();
    expect(workspaceLinkTarget(reference, { ...soloTenant, account_type: "agency" })).toBeNull();
  });
  it("Calendar re-resolves through the incumbent tier map, never exact booking focus", () => {
    const reference = { destination: "calendar" as const, record_id: UUID };
    expect(workspaceLinkTarget(reference, soloTenant)).toEqual({ label: "Open Calendar", to: "/solo/3855/calendar/week", status: "surface_only" });
    expect(workspaceLinkTarget(reference, { ...soloTenant, account_number: 9999 })?.to).toBe("/solo/9999/calendar/week");
    expect(workspaceLinkTarget(reference, subTenant)).toEqual({ label: "Open Calendar", to: "/business/3856/calendar/week", status: "surface_only" });
    expect(routeLinkTarget(reference, "solo", null)).toBeNull();
  });
  it("E2 references re-resolve to the CURRENT account and fail closed outside Solo", () => {
    const reference = { destination: "executive" as const, record_id: null };
    expect(workspaceLinkTarget(reference, soloTenant)?.to).toBe("/solo/3855/command-center/executive");
    expect(workspaceLinkTarget(reference, { ...soloTenant, account_number: 9999 })?.to).toBe("/solo/9999/command-center/executive");
    expect(workspaceLinkTarget(reference, subTenant)).toBeNull();
    expect(routeLinkTarget(reference, "solo", null)).toBeNull();
    expect(routeLinkTarget(reference, "solo", "bad/account")).toBeNull();
  });
  it("opens the named client exactly on Solo", () => {
    expect(workspaceLinkTarget({ destination: "contacts", record_id: UUID, subject: "Acme Ltd" }, soloTenant))
      .toEqual({ label: "Open Acme Ltd", to: `/solo/3855/clients/people?person=${UUID}`, status: "exact" });
    expect(workspaceLinkTarget({ destination: "contacts", record_id: UUID }, soloTenant))
      .toEqual({ label: "Open client record", to: `/solo/3855/clients/people?person=${UUID}`, status: "exact" });
  });
  it("opens a persisted Play in the current account and withholds it outside Solo", () => {
    const reference = { destination: "business_game_plan" as const, record_id: UUID };
    expect(workspaceLinkTarget(reference, soloTenant)).toEqual({ label: "Open Strategic Play",
      to: `/solo/3855/command-center/business-game-plan?play=${UUID}`, status: "exact" });
    expect(workspaceLinkTarget(reference, { ...soloTenant, account_number: 9999 })?.to)
      .toBe(`/solo/9999/command-center/business-game-plan?play=${UUID}`);
    expect(workspaceLinkTarget(reference, subTenant)).toBeNull();
    expect(routeLinkTarget(reference, "solo", "not/an/account")).toBeNull();
  });

  it("names a list as a list, never as the exact record", () => {
    expect(workspaceLinkTarget({ destination: "sales_invoices", record_id: null }, soloTenant))
      .toEqual({ label: "Open invoices", to: "/solo/3855/sales/payments?view=invoices", status: "surface_only" });
    expect(workspaceLinkTarget({ destination: "business_time_zone", record_id: null }, soloTenant))
      .toEqual({ label: "Open business time zone setting", to: "/solo/3855/settings/setup/business-profile#business-time-zone", status: "surface_only" });
  });

  it("gives a sub-account the client list only, and nothing for every other destination", () => {
    expect(workspaceLinkTarget({ destination: "contacts", record_id: UUID, subject: "Acme" }, subTenant))
      .toEqual({ label: "Open Clients", to: "/business/3856/clients/people", status: "surface_only" });
    for (const destination of ["sales_agreements", "sales_invoices", "sales_collections", "operations_work", "business_time_zone"] as const) {
      expect(workspaceLinkTarget({ destination, record_id: null }, subTenant)).toBeNull();
    }
  });

  it("fails closed without an account number, an agency, or no workspace", () => {
    const link = { destination: "contacts", record_id: UUID } as const;
    expect(workspaceLinkTarget(link, { ...soloTenant, account_number: null })).toBeNull();
    expect(workspaceLinkTarget(link, { account_type: "agency", parent_tenant_id: null, account_number: 1 })).toBeNull();
    expect(workspaceLinkTarget(link, null)).toBeNull();
  });
});

describe("routeLinkTarget — a surface already mounted in one tier's tree (E4-S3 PR beta)", () => {
  it("builds the Solo business time zone address, fragment intact, from the route's account", () => {
    expect(routeLinkTarget({ destination: "business_time_zone", record_id: null }, "solo", "3855")).toEqual({
      label: "Open business time zone setting", to: "/solo/3855/settings/setup/business-profile#business-time-zone", status: "surface_only",
    });
  });
  it("is the same answer workspaceLinkTarget gives for that account (one route map, two callers)", () => {
    for (const destination of ["sales_agreements", "sales_invoices", "sales_collections", "operations_work", "business_time_zone"] as const) {
      expect(routeLinkTarget({ destination, record_id: null }, "solo", 3855)).toEqual(workspaceLinkTarget({ destination, record_id: null }, soloTenant));
    }
  });
  it("fails closed for a sub-account Sales destination and for a non-numeric account", () => {
    expect(routeLinkTarget({ destination: "sales_invoices", record_id: null }, "sub_account", "3856")).toBeNull();
    expect(routeLinkTarget({ destination: "business_time_zone", record_id: null }, "solo", "acct-1")).toBeNull();
  });
});
