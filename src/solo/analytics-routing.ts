/** Solo presentation addresses only. Authorization never comes from a route. */
export const SETTINGS_ANALYTICS_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "business-health", label: "Business Health" },
  { key: "operations", label: "Operations" },
  { key: "team", label: "Team" },
  { key: "ai-usage", label: "AI & Usage" },
  { key: "data-health", label: "Data Health" },
] as const;
export type SettingsAnalyticsView = typeof SETTINGS_ANALYTICS_VIEWS[number]["key"];
export function settingsAnalyticsView(splat: string): SettingsAnalyticsView {
  const key = splat.split("/")[2];
  return SETTINGS_ANALYTICS_VIEWS.find(v => v.key === key)?.key ?? "overview";
}
export function analyticsRangeKey(search: string): "week" | "month" | "quarter" {
  const key = new URLSearchParams(search).get("range");
  return key === "month" || key === "quarter" ? key : "week";
}
export function soloAnalyticsCompatibility(account: string, splat: string, search: string): string | null {
  const [branch, view] = splat.split("/");
  if (branch !== "analytics") return null;
  const owners: Record<string, string> = {
    money: "sales/performance", "market-watch": "growth/analytics",
    profitability: "settings/analytics/business-health", retention: "settings/analytics/business-health",
    brief: "command-center/business-game-plan", decisions: "command-center/business-game-plan",
  };
  const destination = owners[view] ?? "settings/analytics/overview";
  // Retain range intent, discard identifiers and references from a retired owner.
  const oldRange = new URLSearchParams(search).get("range");
  const range = destination.startsWith("settings/analytics")
    ? oldRange === "last_30_days" ? "month" : ["week", "month", "quarter"].includes(oldRange ?? "") ? oldRange : null
    : ["week", "month", "quarter", "last_30_days", "current_quarter", "year_to_date"].includes(oldRange ?? "") ? oldRange : null;
  // Calendar-quarter/YTD legacy periods are not renamed into rolling intervals.
  const query = range ? `?range=${encodeURIComponent(range)}` : "";
  return `/solo/${encodeURIComponent(account)}/${destination}${query}`;
}
