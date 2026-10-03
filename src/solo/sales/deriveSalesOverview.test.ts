import { describe, expect, it } from "vitest";
import { deriveSalesOverview, type SalesOverviewInput } from "./deriveSalesOverview";

const source = <T,>(rows: readonly T[], extra = {}) => ({ tenantId: "test-tenant-a", phase: "ready", readable: true, rows, ...extra });
const input = (): SalesOverviewInput => ({ tenantId: "test-tenant-a", deals: source([{ id: "d1", title: "Discovery", clientName: "Test client", status: "open", stageId: "s1", nextAction: "Call", createdAt: "2026-10-01", updatedAt: "2026-10-02" }]), terms: source([{ id: "t1", contactId: "c1", status: "draft" }]), signings: source([{ id: "a1", documentTitle: "Scope", displayState: "sent" }]), invoices: source([{ id: "i1", number: "DRAFT-1", snapshot: { client_id: "c1", kind: "one_time" } }]), stages: [{ id: "s1", label: "Discovery" }], clients: [{ id: "c1", name: "Test client" }], period: "all", now: Date.parse("2026-10-03") });

describe("Sales operating Overview independent source truth", () => {
  it("keeps deals, engagement terms, signature documents and invoice drafts independent", () => {
    const result = deriveSalesOverview(input());
    expect(result.rows.map(row => row.source)).toEqual(["deals", "terms", "signings", "invoices"]);
    expect(result.rows.every(row => !('amount' in row))).toBe(true);
    expect(result.stages).toEqual([{ id: "s1", label: "Discovery", count: 1 }]);
  });
  it("refuses stale tenant, failed and unreadable rows instead of showing empty as known", () => {
    const current = input();
    current.deals = source(current.deals.rows, { tenantId: "test-tenant-b" });
    current.terms = source(current.terms.rows, { phase: "error" });
    current.signings = source(current.signings.rows, { readable: false });
    const result = deriveSalesOverview(current);
    expect(result.rows.map(row => row.source)).toEqual(["invoices"]);
    expect(result.counts.deals).toBeNull();
    expect(result.counts.terms).toBeNull();
    expect(result.counts.signings).toBeNull();
  });
  it("uses created-date period for deals only and never fabricates a resolved activity stream", () => {
    const current = input();
    current.period = "7d";
    current.deals = source([{ ...current.deals.rows[0], createdAt: "2026-08-01" }]);
    const result = deriveSalesOverview(current);
    expect(result.counts.deals).toBe(0);
    expect(result.counts.invoices).toBe(1);
    expect(result.rows.some(row => row.source === "deals")).toBe(false);
  });
});
