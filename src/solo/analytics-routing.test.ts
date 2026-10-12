import { describe, expect, it } from "vitest";
import { analyticsRangeKey, SETTINGS_ANALYTICS_VIEWS, settingsAnalyticsView, soloAnalyticsCompatibility } from "./analytics-routing";
describe("Solo Analytics ownership", () => {
  it.each(SETTINGS_ANALYTICS_VIEWS)("deep-links $key", ({ key }) => {
    expect(settingsAnalyticsView(`settings/analytics/${key}`)).toBe(key);
  });
  it.each([
    ["money", "sales/performance"], ["market-watch", "growth/analytics"],
    ["profitability", "settings/analytics/business-health"], ["retention", "settings/analytics/business-health"],
    ["brief", "command-center/business-game-plan"], ["decisions", "command-center/business-game-plan"],
    ["unknown", "settings/analytics/overview"], ["", "settings/analytics/overview"],
  ])("routes historical %s to its canonical owner", (old, owner) => {
    expect(soloAnalyticsCompatibility("42", `analytics/${old}`, "?range=week&tenant_id=foreign&evidence_ref=private")).toBe(`/solo/42/${owner}?range=week`);
  });
  it("cannot change another shell or preserve arbitrary routing authority", () => {
    expect(soloAnalyticsCompatibility("42", "sales/performance", "")).toBeNull();
    expect(analyticsRangeKey("?range=arbitrary")).toBe("week");
    expect(settingsAnalyticsView("settings/analytics/unknown")).toBe("overview");
  });
  it("preserves equivalent periods without claiming calendar periods are rolling ones", () => {
    expect(soloAnalyticsCompatibility("42", "analytics/retention", "?range=last_30_days")).toBe("/solo/42/settings/analytics/business-health?range=month");
    expect(soloAnalyticsCompatibility("42", "analytics/profitability", "?range=current_quarter")).toBe("/solo/42/settings/analytics/business-health");
    expect(soloAnalyticsCompatibility("42", "analytics/money", "?range=year_to_date")).toBe("/solo/42/sales/performance?range=year_to_date");
  });
});
