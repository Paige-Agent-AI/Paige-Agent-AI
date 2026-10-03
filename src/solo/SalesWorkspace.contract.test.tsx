import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { branchBySlug, subtabPath } from "../lib/routing/tierBranches";
import { tenantShellDestinationsForPath } from "../components/tenant-shell/tenantShellRoutes";

describe("Solo Sales department mount", () => {
  it("owns the seven canonical destinations without removing mixed Marketing Catalog", () => {
    expect(branchBySlug("solo", "sales")?.subtabs?.map(tab => [tab.slug, tab.label])).toEqual([
      ["overview", "Overview"], ["opportunities", "Opportunities"], ["pipeline", "Pipeline"],
      ["offers", "Offers"], ["agreements", "Terms & Agreements"], ["payments", "Payments"], ["performance", "Performance"],
    ]);
    expect(subtabPath("solo", "test-tenant-a", "sales", "payments")).toBe("/solo/test-tenant-a/sales/payments");
    expect(branchBySlug("solo", "growth")?.subtabs?.some(tab => tab.slug === "catalog")).toBe(true);
    expect(branchBySlug("sub_account", "sales")).toBeNull();
    expect(branchBySlug("agency", "sales")).toBeNull();
  });

  it("shows the top-level Sales entry only in the authenticated standalone Solo shell", () => {
    expect(tenantShellDestinationsForPath("/solo/test-tenant-a/sales", "standalone").find(item => item.id === "sales")?.href).toBe("/solo/test-tenant-a/sales");
    for (const [path, type] of [["/business/test-tenant-a", "sub_account"], ["/solo/test-tenant-a", "sub_account"], ["/enterprise/test-tenant-a", "enterprise"], ["/agency/test-tenant-a", "agency"], ["/solo/test-tenant-a", null]] as const) {
      expect(tenantShellDestinationsForPath(path, type).some(item => item.id === "sales")).toBe(false);
    }
  });

  it("mounts Sales in the single Solo screen host", () => {
    const source = readFileSync("src/solo/SoloApp.tsx", "utf8");
    expect(source).toContain('sales:<SalesWorkspace');
    expect(source.match(/data-solo-screen-host/g)?.length).toBe(1);
  });
});
