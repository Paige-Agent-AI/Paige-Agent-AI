// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DESTINATION_LABEL, workspaceLinkTarget, workspaceLinkTier } from "./workspaceLinks";

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
    });
  });
});

describe("workspaceLinkTarget", () => {
  it("opens the named client exactly on Solo", () => {
    expect(workspaceLinkTarget({ destination: "contacts", record_id: UUID, subject: "Acme Ltd" }, soloTenant))
      .toEqual({ label: "Open Acme Ltd", to: `/solo/3855/clients/people?person=${UUID}`, status: "exact" });
    expect(workspaceLinkTarget({ destination: "contacts", record_id: UUID }, soloTenant))
      .toEqual({ label: "Open client record", to: `/solo/3855/clients/people?person=${UUID}`, status: "exact" });
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
