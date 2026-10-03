import { expect, it } from "vitest";
import { legacySalesRoute } from "./legacySalesRoute";
it.each([["", "overview", ""], ["command", "overview", ""], ["terms", "agreements", ""], ["agreements", "agreements", ""], ["invoices", "payments", "view=invoices"], ["recurring", "payments", "view=recurring"], ["payments", "payments", "view=payments"], ["revenue", "payments", "view=revenue"], ["scenarios", "payments", "view=scenarios"], ["unknown", "overview", ""]])("preserves legacy Sales view %s", (view, destination, query) => {
  expect(legacySalesRoute("test-account", "sales", view ? `?view=${view}` : "", "")).toBe(`/solo/test-account/sales/${destination}${query ? `?${query}` : ""}`);
});
it("preserves record/query/hash intent in the current account and drops authority/return URLs", () => {
  expect(legacySalesRoute("test-account", "pipeline", "?deal=deal-a&new=opportunity&tenant=other&returnTo=https://evil.test", "#record")).toBe("/solo/test-account/sales/pipeline?deal=deal-a&new=opportunity#record");
  expect(legacySalesRoute("test-account", "sales", "?view=terms&resume=terms&person=person-a", "#terms")).toBe("/solo/test-account/sales/agreements?resume=terms&person=person-a#terms");
});
it("preserves published assets rather than globally redirecting Catalog", () => {
  for (const type of ["all", "page", "form", "funnel"]) expect(legacySalesRoute("test-account", "catalog", `?type=${type}`, "")).toBeNull();
  expect(legacySalesRoute("test-account", "catalog", "?origin=sales&resume=terms", "")).toBe("/solo/test-account/sales/offers?origin=sales&resume=terms");
  expect(legacySalesRoute("test-account", "social", "", "")).toBeNull();
  expect(legacySalesRoute(null, "sales", "", "")).toBeNull();
});
